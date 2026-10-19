/**
 * 工作区 Git 状态服务与只读/操作 HTTP 路由。
 *
 * 工作区列表来自 Host 的 workspaceRegistry，客户端不依赖任何前端快照
 * 形状。路由只服务回环地址：响应里带本机绝对路径，不能暴露给远程访问。
 * 操作路由额外校验 Origin 与 JSON Content-Type，挡住跨站表单和简单请求；
 * 所有写操作按工作区串行执行，避免同一仓库的并发写冲突。
 */

import { normalizeAction, readGitStatus, runAction } from './git.js';

export const API_PREFIX = '/api/workspace-git';
const CACHE_TTL_MS = 1_000;
const MAX_BODY_BYTES = 8 * 1024;

function isLoopback(req) {
  const address = req.socket.remoteAddress;
  if (address !== '::1' && address !== '127.0.0.1' && address !== '::ffff:127.0.0.1') return false;
  const rawHost = String(req.headers.host ?? '');
  if (!rawHost) return false;
  const host = rawHost.startsWith('[') ? rawHost.slice(0, rawHost.indexOf(']') + 1) : rawHost.split(':')[0];
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

/**
 * 写操作要求 Origin 与 Host 同源。浏览器同源 fetch 会带 Origin，跨站表单
 * 不会带 JSON Content-Type；两者同时校验，避免被普通表单或预检绕过。
 */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 一轮扫描：读取全部工作区，逐个并发跑 git。
 *
 * 1 秒缓存挡住 5 秒轮询与手动刷新重叠时的重复工作；同一时刻只有一个
 * 扫描在跑，后到的请求复用它。
 */
export function createStatusService(ctx) {
  let gitPromise;
  let inflight;
  let cached;
  let cachedAt = 0;

  const resolveGit = () => {
    gitPromise ??= ctx.subprocess.resolveExecutable('git').catch(error => {
      gitPromise = undefined;
      throw error;
    });
    return gitPromise;
  };

  const run = async () => {
    const workspaces = ctx.workspaceRegistry.list();
    let gitPath;
    try {
      gitPath = await resolveGit();
    } catch {
      return { scannedAt: new Date().toISOString(), error: 'git-not-found', workspaces: [] };
    }

    const results = await Promise.all(
      workspaces.map(async workspace => ({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
        ...(await readGitStatus(ctx.subprocess, gitPath, workspace.path)),
      })),
    );
    return { scannedAt: new Date().toISOString(), workspaces: results };
  };

  const scan = ({ force = false } = {}) => {
    if (!force && cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
    if (!inflight) {
      inflight = run()
        .then(result => {
          cached = result;
          cachedAt = Date.now();
          return result;
        })
        .finally(() => {
          inflight = undefined;
        });
    }
    return inflight;
  };

  const queues = new Map();

  const act = async (workspaceId, request) => {
    const workspace = ctx.workspaceRegistry.get(workspaceId);
    if (!workspace) return { status: 404, body: { ok: false, error: 'workspace not found' } };

    const gitPath = await resolveGit();
    const previous = queues.get(workspace.id) ?? Promise.resolve();
    const current = previous.then(() => runAction(ctx.subprocess, gitPath, workspace.path, request));
    queues.set(
      workspace.id,
      current.catch(() => {}),
    );

    const result = await current;
    cached = undefined;
    return { status: result.ok ? 200 : 400, body: result };
  };

  return { scan, act };
}

export function createApi(service) {
  return async (req, res) => {
    if (!isLoopback(req)) {
      json(res, { error: 'workspace-git-status only serves loopback clients' }, 403);
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === `${API_PREFIX}/status`) {
      if (req.method !== 'GET') {
        json(res, { error: 'method not allowed' }, 405);
        return;
      }
      try {
        json(res, await service.scan({ force: url.searchParams.get('force') === '1' }));
      } catch (error) {
        json(res, { error: error instanceof Error ? error.message : String(error) }, 500);
      }
      return;
    }

    if (url.pathname === `${API_PREFIX}/action`) {
      if (req.method !== 'POST') {
        json(res, { error: 'method not allowed' }, 405);
        return;
      }
      if (!isSameOrigin(req) || !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        json(res, { error: 'invalid request origin or content type' }, 403);
        return;
      }

      try {
        const body = JSON.parse(await readBody(req));
        const request = normalizeAction(body.action, body.branch, body.message);
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
        if (!workspaceId) {
          json(res, { ok: false, error: 'workspaceId is required' }, 400);
          return;
        }
        const result = await service.act(workspaceId, request);
        json(res, result.body, result.status);
      } catch (error) {
        json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
      }
      return;
    }

    json(res, { error: 'not found' }, 404);
  };
}

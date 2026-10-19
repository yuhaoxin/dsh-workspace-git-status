/**
 * 工作区 Git 状态服务与只读 HTTP 路由。
 *
 * 工作区列表来自 Host 的 workspaceRegistry，客户端不依赖任何前端快照
 * 形状。路由只服务回环地址：响应里带本机绝对路径，不能暴露给远程访问。
 */

import { readGitStatus } from './git.js';

export const API_PREFIX = '/api/workspace-git';
const CACHE_TTL_MS = 1_000;

function isLoopback(req) {
  const address = req.socket.remoteAddress;
  if (address !== '::1' && address !== '127.0.0.1' && address !== '::ffff:127.0.0.1') return false;
  const rawHost = String(req.headers.host ?? '');
  if (!rawHost) return false;
  const host = rawHost.startsWith('[') ? rawHost.slice(0, rawHost.indexOf(']') + 1) : rawHost.split(':')[0];
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
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

  return {
    scan({ force = false } = {}) {
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
    },
  };
}

export function createApi(service) {
  return async (req, res) => {
    if (!isLoopback(req)) {
      json(res, { error: 'workspace-git-status only serves loopback clients' }, 403);
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== `${API_PREFIX}/status`) {
      json(res, { error: 'not found' }, 404);
      return;
    }
    if (req.method !== 'GET') {
      json(res, { error: 'method not allowed' }, 405);
      return;
    }

    json(res, await service.scan({ force: url.searchParams.get('force') === '1' }));
  };
}

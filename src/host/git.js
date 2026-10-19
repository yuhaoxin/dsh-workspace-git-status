/**
 * 读取一个工作区的 Git 状态。
 *
 * `git` 可执行文件由调用方解析一次并以绝对路径传入。命令固定使用
 * porcelain v2，计数来自稳定的机器格式；环境固定为 C locale，因为非英文
 * 系统上 `git status` 的致命错误也是本地化文本，而本模块要靠这两条英文
 * 消息区分“不是仓库”和“裸仓库”。
 */

const TIMEOUT_MS = 5_000;
const GRACE_MS = 2_000;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

/**
 * 解析 `git status --porcelain=v2 --branch` 的成功输出。
 *
 * 只依赖行首标记与 XY 两位；路径与相似度字段不参与计数。
 */
export function parsePorcelainV2(text) {
  const status = {
    state: 'repo',
    branch: null,
    detached: false,
    oid: null,
    upstream: null,
    ahead: null,
    behind: null,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
  };

  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice('# branch.oid '.length).trim();
      status.oid = oid === '(initial)' ? null : oid;
    } else if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      if (head === '(detached)') status.detached = true;
      else status.branch = head;
    } else if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice('# branch.upstream '.length).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const match = /^\+(\d+) -(\d+)$/.exec(line.slice('# branch.ab '.length).trim());
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4);
      if (xy[0] !== '.') status.staged += 1;
      if (xy[1] !== '.') status.unstaged += 1;
    } else if (line.startsWith('u ')) {
      status.conflicts += 1;
    } else if (line.startsWith('? ')) {
      status.untracked += 1;
    }
  }

  return status;
}

function readText(reader) {
  return reader ? reader.readFrom(0).text : '';
}

function firstLine(text) {
  return text.split('\n', 1)[0].trim();
}

/**
 * 在工作区目录跑一次 `git status` 并归一化成面板用的状态对象。
 *
 * 返回值总是 `{ state, ... }`，不会抛错：单个工作区的失败不能中断整轮扫描。
 */
export async function readGitStatus(subprocess, gitPath, workspacePath) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const handle = subprocess.spawn({
      argv: [gitPath, 'status', '--porcelain=v2', '--branch', '--untracked-files=normal'],
      cwd: workspacePath,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_STDOUT_BYTES },
        stderr: { maxBytes: MAX_STDERR_BYTES },
      },
      graceMs: GRACE_MS,
      signal: controller.signal,
      env: { LC_ALL: 'C', LANG: 'C' },
    });

    const outcome = await handle.done;
    if (timedOut) return { state: 'error', error: 'timeout' };

    const stderr = readText(handle.collected.stderr);
    if (outcome.exitCode === 0) return parsePorcelainV2(readText(handle.collected.stdout));
    if (outcome.exitCode === 128 && /not a git repository/i.test(stderr)) {
      return { state: 'not-repo' };
    }
    if (outcome.exitCode === 128 && /must be run in a work tree/i.test(stderr)) {
      return { state: 'error', error: 'bare repository' };
    }
    return {
      state: 'error',
      error: firstLine(stderr) || `git exited with ${outcome.exitCode ?? outcome.signal}`,
    };
  } catch (error) {
    if (timedOut) return { state: 'error', error: 'timeout' };
    return { state: 'error', error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

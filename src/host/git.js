/**
 * 读取一个工作区的 Git 状态，并执行面板允许的少量写操作。
 *
 * `git` 可执行文件由调用方解析一次并以绝对路径传入。所有命令固定使用
 * C locale：非英文系统上 `git status` 的致命错误也是本地化文本，而本模块
 * 要靠这两条英文消息区分“不是仓库”和“裸仓库”。写操作同样固定 locale，
 * 让错误信息可以直接展示。
 */

const TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 30_000;
const GRACE_MS = 2_000;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

/**
 * 解析 `git status --porcelain=v2 --branch -z` 的成功输出。
 *
 * 记录以 NUL 分隔；重命名/复制条目（`2 `）在路径之后多一个 NUL 分隔的
 * 原路径。路径可以包含空格和换行，所以不能按行切。
 *
 * 计数来自 XY 两位与行首标记；文件条目同时按状态分组返回，供面板展开。
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
    files: { staged: [], unstaged: [], untracked: [], conflicts: [] },
  };

  const records = text.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === '') continue;

    if (record.startsWith('# branch.oid ')) {
      const oid = record.slice('# branch.oid '.length).trim();
      status.oid = oid === '(initial)' ? null : oid;
    } else if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length).trim();
      if (head === '(detached)') status.detached = true;
      else status.branch = head;
    } else if (record.startsWith('# branch.upstream ')) {
      status.upstream = record.slice('# branch.upstream '.length).trim();
    } else if (record.startsWith('# branch.ab ')) {
      const match = /^\+(\d+) -(\d+)$/.exec(record.slice('# branch.ab '.length).trim());
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const xy = record.slice(2, 4);
      const renamed = record.startsWith('2 ');
      const path = pathOf(record);
      const previous = renamed ? records[++index] : undefined;
      const file = { path, index: xy[0], worktree: xy[1] };
      if (renamed) file.from = previous;
      if (xy[0] !== '.') {
        status.staged += 1;
        status.files.staged.push(file);
      }
      if (xy[1] !== '.') {
        status.unstaged += 1;
        status.files.unstaged.push(file);
      }
    } else if (record.startsWith('u ')) {
      status.conflicts += 1;
      status.files.conflicts.push({ path: pathOf(record) });
    } else if (record.startsWith('? ')) {
      status.untracked += 1;
      status.files.untracked.push({ path: record.slice(2) });
    }
  }

  return status;
}

/**
 * 取普通/重命名条目的路径。`1 ` 的路径从第 9 个空格后开始，`2 ` 的路径在
 * 相似度字段之后；两者都用最后一个空格后的剩余部分，路径本身可以含空格。
 */
function pathOf(record) {
  const fields = record.split(' ');
  return record.startsWith('2 ')
    ? fields.slice(9).join(' ')
    : fields.slice(8).join(' ');
}

function readText(reader) {
  return reader ? reader.readFrom(0).text : '';
}

function firstLine(text) {
  return text.split('\n', 1)[0].trim();
}

/**
 * 跑一条 git 命令并返回退出结果。只用于状态读取与操作，不解释业务语义。
 */
async function runGit(subprocess, gitPath, cwd, args, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const handle = subprocess.spawn({
      argv: [gitPath, ...args],
      cwd,
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
    return {
      timedOut,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      stdout: readText(handle.collected.stdout),
      stderr: readText(handle.collected.stderr),
    };
  } catch (error) {
    return {
      timedOut,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 读取状态。返回值总是 `{ state, ... }`，不会抛错：单个工作区的失败不能
 * 中断整轮扫描。
 */
export async function readGitStatus(subprocess, gitPath, workspacePath) {
  const result = await runGit(
    subprocess,
    gitPath,
    workspacePath,
    ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'],
    TIMEOUT_MS,
  );

  if (result.timedOut) return { state: 'error', error: 'timeout' };
  if (result.exitCode === 0) return parsePorcelainV2(result.stdout);
  if (result.exitCode === 128 && /not a git repository/i.test(result.stderr)) {
    return { state: 'not-repo' };
  }
  if (result.exitCode === 128 && /must be run in a work tree/i.test(result.stderr)) {
    return { state: 'error', error: 'bare repository' };
  }
  return {
    state: 'error',
    error: firstLine(result.stderr) || `git exited with ${result.exitCode ?? result.signal}`,
  };
}

const ACTIONS = {
  stage: () => ['add', '--all'],
  unstage: () => ['reset', '--quiet'],
  commit: message => ['commit', '-m', message],
  fetch: () => ['fetch', '--prune'],
  pull: () => ['pull', '--ff-only'],
  push: () => ['push'],
  branches: () => ['branch', '--format=%(refname:short)'],
  checkout: branch => ['checkout', branch],
  createBranch: branch => ['checkout', '-b', branch],
  discard: () => ['reset', '--hard', 'HEAD'],
};

/**
 * 校验面板能发起的动作参数。返回值是规范化后的参数，非法输入抛错。
 */
export function normalizeAction(action, branch, message) {
  if (!Object.hasOwn(ACTIONS, action)) throw new Error('unknown action');
  if (action === 'checkout' || action === 'createBranch') {
    if (typeof branch !== 'string' || branch.trim() === '') throw new Error('branch is required');
    return { action, branch: branch.trim() };
  }
  if (action === 'commit') {
    if (typeof message !== 'string' || message.trim() === '') throw new Error('commit message is required');
    return { action, message: message.trim() };
  }
  return { action };
}

/**
 * 执行一个动作。调用方已经校验过参数与工作区存在性。
 */
export async function runAction(subprocess, gitPath, workspacePath, request) {
  const args = ACTIONS[request.action](request.branch ?? request.message);
  const result = await runGit(subprocess, gitPath, workspacePath, args, ACTION_TIMEOUT_MS);

  if (request.action === 'discard' && result.exitCode === 0) {
    const clean = await runGit(subprocess, gitPath, workspacePath, ['clean', '-fd'], ACTION_TIMEOUT_MS);
    if (clean.exitCode !== 0) {
      return { ok: false, error: firstLine(clean.stderr) || 'clean failed' };
    }
  }

  if (request.action === 'branches') {
    if (result.exitCode !== 0) return { ok: false, error: firstLine(result.stderr) || 'git branch failed' };
    return { ok: true, branches: result.stdout.split('\n').map(line => line.trim()).filter(Boolean) };
  }

  if (result.exitCode !== 0) {
    return { ok: false, error: firstLine(result.stderr) || `git exited with ${result.exitCode ?? result.signal}` };
  }
  return { ok: true };
}

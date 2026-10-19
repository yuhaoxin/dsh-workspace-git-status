import test from 'node:test';
import assert from 'node:assert/strict';

import { createStatusService } from '../src/host/status.js';

function reader(text) {
  return { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) };
}

/**
 * 扫描必须只返回 Git 仓库：面板没有为“不是仓库”的工作区保留任何展示或操作。
 * 假的 subprocess 按 cwd 区分仓库与普通目录。
 */
test('omits workspaces that are not git repositories', async () => {
  const subprocess = {
    resolveExecutable: async () => '/usr/bin/git',
    spawn(spec) {
      if (spec.cwd === '/plain') {
        return {
          done: Promise.resolve({ exitCode: 128, signal: null }),
          collected: {
            stdout: reader(''),
            stderr: reader('fatal: not a git repository (or any of the parent directories): .git\n'),
          },
        };
      }
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: reader('# branch.oid 3e7c4cb18c8ed05308bd879ea013684b8954999a\0# branch.head main\0'), stderr: reader('') },
      };
    },
  };

  const service = createStatusService({
    workspaceRegistry: {
      list: () => [
        { id: 'repo', title: 'repo', path: '/repo' },
        { id: 'plain', title: 'plain', path: '/plain' },
      ],
    },
    subprocess,
  });

  const data = await service.scan({ force: true });
  assert.deepEqual(data.workspaces.map(workspace => workspace.id), ['repo']);
  assert.equal(data.workspaces[0].state, 'repo');
  assert.equal(data.workspaces[0].branch, 'main');
});

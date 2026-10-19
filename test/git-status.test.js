import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parsePorcelainV2, readGitStatus } from '../src/host/git.js';

const NORMAL = [
  '# branch.oid 3e7c4cb18c8ed05308bd879ea013684b8954999a',
  '# branch.head main',
  '1 .M N... 100644 100644 100644 78981922613b2afb6025042ff6bd878ac1994e85 78981922613b2afb6025042ff6bd878ac1994e85 a.txt',
  '2 R. N... 100644 100644 100644 61780798228d17af2d34fce4cfbdf35556832472 61780798228d17af2d34fce4cfbdf35556832472 R100 b2.txt\tb.txt',
  '1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 f2ad6c76f0115a6ba5b00456a849810e7ec0af20 c.txt',
  '? d.txt',
  '',
].join('\n');

test('counts staged, unstaged, and untracked entries', () => {
  const status = parsePorcelainV2(NORMAL);
  assert.equal(status.state, 'repo');
  assert.equal(status.branch, 'main');
  assert.equal(status.detached, false);
  assert.equal(status.oid, '3e7c4cb18c8ed05308bd879ea013684b8954999a');
  assert.equal(status.staged, 2);
  assert.equal(status.unstaged, 1);
  assert.equal(status.untracked, 1);
  assert.equal(status.conflicts, 0);
  assert.equal(status.ahead, null);
  assert.equal(status.behind, null);
});

test('reads an unborn branch without an oid', () => {
  const status = parsePorcelainV2('# branch.oid (initial)\n# branch.head main\n? x.txt\n');
  assert.equal(status.oid, null);
  assert.equal(status.branch, 'main');
  assert.equal(status.untracked, 1);
});

test('reads a detached HEAD', () => {
  const status = parsePorcelainV2(
    '# branch.oid 9a77208556b6e2d31795b37531ea5225e52c466b\n# branch.head (detached)\n1 .M N... a b c\n? d.txt\n',
  );
  assert.equal(status.detached, true);
  assert.equal(status.branch, null);
  assert.equal(status.unstaged, 1);
  assert.equal(status.untracked, 1);
});

test('reads upstream ahead and behind counts', () => {
  const status = parsePorcelainV2(
    '# branch.oid e0ff04edb8627f066613f8d316e1f8d2d425cf6e\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +1 -3\n',
  );
  assert.equal(status.upstream, 'origin/main');
  assert.equal(status.ahead, 1);
  assert.equal(status.behind, 3);
});

test('counts unmerged entries as conflicts', () => {
  const status = parsePorcelainV2('u UU N... 100644 100644 100644 100644 a b c conflict.txt\n');
  assert.equal(status.conflicts, 1);
  assert.equal(status.staged, 0);
  assert.equal(status.unstaged, 0);
});

function reader(text) {
  return { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) };
}

function stub({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  const calls = [];
  return {
    calls,
    subprocess: {
      spawn(spec) {
        calls.push(spec);
        return {
          done: Promise.resolve({ exitCode, signal: null }),
          collected: { stdout: reader(stdout), stderr: reader(stderr) },
        };
      },
    },
  };
}

test('runs git with the pinned locale and porcelain v2', async () => {
  const { subprocess, calls } = stub({ stdout: NORMAL });
  const status = await readGitStatus(subprocess, '/usr/bin/git', '/work');
  assert.equal(calls[0].cwd, '/work');
  assert.deepEqual(calls[0].argv, [
    '/usr/bin/git',
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=normal',
  ]);
  assert.equal(calls[0].env.LC_ALL, 'C');
  assert.equal(status.staged, 2);
});

test('maps the non-repository fatal error', async () => {
  const { subprocess } = stub({
    exitCode: 128,
    stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
  });
  assert.deepEqual(await readGitStatus(subprocess, '/usr/bin/git', '/work'), { state: 'not-repo' });
});

test('maps a bare repository to an error', async () => {
  const { subprocess } = stub({
    exitCode: 128,
    stderr: 'fatal: this operation must be run in a work tree\n',
  });
  assert.deepEqual(await readGitStatus(subprocess, '/usr/bin/git', '/work'), {
    state: 'error',
    error: 'bare repository',
  });
});

test('parses a real temporary repository', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-workspace-git-status-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
  const status = () =>
    parsePorcelainV2(
      execFileSync('git', ['status', '--porcelain=v2', '--branch', '--untracked-files=normal'], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      }),
    );

  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(directory, 'a.txt'), 'a\n');

    const unborn = status();
    assert.equal(unborn.branch, 'main');
    assert.equal(unborn.oid, null);
    assert.equal(unborn.untracked, 1);

    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    writeFileSync(join(directory, 'a.txt'), 'a2\n');
    writeFileSync(join(directory, 'b.txt'), 'b\n');

    const changed = status();
    assert.equal(changed.branch, 'main');
    assert.equal(changed.unstaged, 1);
    assert.equal(changed.untracked, 1);
    assert.equal(changed.staged, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

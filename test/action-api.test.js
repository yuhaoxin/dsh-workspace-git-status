import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createApi } from '../src/host/status.js';

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

test('guards the action route and dispatches validated requests', async () => {
  const seen = [];
  const service = {
    scan: async () => ({ scannedAt: '2026-10-19T00:00:00.000Z', workspaces: [] }),
    act: async (workspaceId, request) => {
      seen.push({ workspaceId, request });
      return { status: 200, body: { ok: true } };
    },
  };

  const server = await listen(createApi(service));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const status = await fetch(`${base}/api/workspace-git/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { scannedAt: '2026-10-19T00:00:00.000Z', workspaces: [] });

    const noOrigin = await fetch(`${base}/api/workspace-git/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(noOrigin.status, 403);

    const wrongType = await fetch(`${base}/api/workspace-git/action`, {
      method: 'POST',
      headers: { origin: base },
      body: '{}',
    });
    assert.equal(wrongType.status, 403);

    const unknown = await fetch(`${base}/api/workspace-git/action`, {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'w1', action: 'rm' }),
    });
    assert.equal(unknown.status, 400);
    assert.deepEqual(seen, []);

    const missing = await fetch(`${base}/api/workspace-git/action`, {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stage' }),
    });
    assert.equal(missing.status, 400);
    assert.deepEqual(seen, []);

    const ok = await fetch(`${base}/api/workspace-git/action`, {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'w1', action: 'stage' }),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    assert.deepEqual(seen, [{ workspaceId: 'w1', request: { action: 'stage' } }]);
  } finally {
    await close(server);
  }
});

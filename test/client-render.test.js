import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 用最小的 React 替身渲染 GitPanel，检查行内按钮随改动数出现或消失。
 * 组件只在这一轮渲染里被调用，useState 返回初始值，useEffect 不执行。
 */

let loaded;
const dictionaries = new Map();
let snapshot = { data: null, error: null, refreshing: false };

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition;
    },
  },
};

const FRAGMENT = Symbol('react.fragment');

const React = {
  Fragment: FRAGMENT,
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useSyncExternalStore: () => snapshot,
};

await import('../client.js');

function makeRequire() {
  return name => {
    assert.equal(name, 'react');
    return React;
  };
}

function makeContext() {
  const registrations = [];
  return {
    registrations,
    ctx: {
      effect(callback) {
        return callback();
      },
      locale: {
        register(namespace, dicts) {
          dictionaries.set(namespace, dicts);
          return () => {};
        },
        bind(namespace) {
          return key => dictionaries.get(namespace)?.zh?.[key] ?? key;
        },
      },
      slots: {
        inject(_slot, callback) {
          registrations.push(callback());
        },
        register(options, component) {
          return { options, component };
        },
      },
    },
  };
}

function render(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(render);
  if (node.type === FRAGMENT) return render(node.children);
  if (typeof node.type === 'function') return render(node.type(node.props));
  return { type: node.type, props: node.props, children: render(node.children) };
}

function walk(node, visit) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach(child => walk(child, visit));
    return;
  }
  if (typeof node === 'string') return;
  visit(node);
  walk(node.children, visit);
}

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
}

function buttonLabels(tree) {
  const labels = [];
  walk(tree, node => {
    if (node.type === 'button') labels.push(textOf(node).trim());
  });
  return labels;
}

function workspace(changes) {
  return {
    id: 'ws-1',
    title: 'demo',
    path: '/tmp/demo',
    state: 'repo',
    branch: 'main',
    detached: false,
    oid: '3e7c4cb18c8ed05308bd879ea013684b8954999a',
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    ahead: 0,
    behind: 0,
    files: { staged: [], unstaged: [], untracked: [], conflicts: [] },
    ...changes,
  };
}

function renderPanel(row) {
  snapshot = {
    data: { scannedAt: new Date().toISOString(), workspaces: [row] },
    error: null,
    refreshing: false,
  };
  const { ctx, registrations } = makeContext();
  loaded.factory(makeRequire()).apply(ctx);
  const panel = registrations.find(entry => entry.options.name === 'main');
  return render(React.createElement(panel.component, {}));
}

test('hides discard and commit when a workspace has no changes', () => {
  const labels = buttonLabels(renderPanel(workspace({})));

  assert.deepEqual(labels, ['刷新', '暂存全部', '取消暂存', '抓取', '拉取', '推送', '分支', '文件']);
  assert.equal(labels.includes('丢弃改动'), false);
  assert.equal(labels.includes('提交'), false);
});

test('shows discard and commit for every kind of pending change', () => {
  const cases = [
    { name: 'staged', changes: { staged: 1 } },
    { name: 'unstaged', changes: { unstaged: 2 } },
    { name: 'untracked', changes: { untracked: 1 } },
    { name: 'conflicts', changes: { conflicts: 1 } },
  ];

  for (const { name, changes } of cases) {
    const labels = buttonLabels(renderPanel(workspace(changes)));
    assert.equal(labels.includes('丢弃改动'), true, `${name}: discard missing`);
    assert.equal(labels.includes('提交'), true, `${name}: commit missing`);
  }
});

test('shows the current workspace repository in the composer dock', () => {
  const { ctx, registrations } = makeContext();
  loaded.factory(makeRequire()).apply(ctx);
  const dock = registrations.find(entry => entry.options.name === 'conversation.composer.dock');

  const hooks = {
    sessionId: 's-1',
    useWorkspaces: selector => selector({ items: [{ workspaceId: 'ws-1', path: '/tmp/demo', title: 'demo', sessionIds: ['s-1'] }] }),
    useWorkspaceGit: selector => selector(snapshot),
    t: key => dictionaries.get('workspaceGitStatus').zh[key] ?? key,
  };

  snapshot = {
    data: {
      scannedAt: new Date().toISOString(),
      workspaces: [workspace({ staged: 2, unstaged: 1, ahead: 3 })],
    },
    error: null,
    refreshing: false,
  };

  const text = textOf(render(React.createElement(dock.component, hooks)));
  assert.equal(text, 'main · 2 已暂存 · 1 未暂存 · ↑3 ↓0');
});

test('shows nothing in the composer dock outside a Git repository', () => {
  const { ctx, registrations } = makeContext();
  loaded.factory(makeRequire()).apply(ctx);
  const dock = registrations.find(entry => entry.options.name === 'conversation.composer.dock');
  const hooks = {
    sessionId: 's-1',
    useWorkspaces: selector => selector({ items: [{ workspaceId: 'ws-2', path: '/tmp/plain', title: 'plain', sessionIds: ['s-1'] }] }),
    useWorkspaceGit: selector => selector(snapshot),
    t: key => dictionaries.get('workspaceGitStatus').zh[key] ?? key,
  };

  // ws-2 不是 Git 仓库，状态接口里没有它的行。
  assert.equal(render(React.createElement(dock.component, hooks)), null);
});

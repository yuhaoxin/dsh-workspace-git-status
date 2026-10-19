import test from 'node:test';
import assert from 'node:assert/strict';

let loaded;
const dictionaries = new Map();

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition;
    },
  },
};

await import('../client.js');

function makeRequire() {
  return name => {
    assert.equal(name, 'react');
    return {
      createElement: () => null,
      useSyncExternalStore: () => ({ data: null, error: null, refreshing: false }),
    };
  };
}

function makeContext() {
  const registrations = [];
  const ctx = {
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
  };
  return { ctx, registrations };
}

test('registers the sidebar icon and the main panel under one id', () => {
  const { ctx, registrations } = makeContext();
  const plugin = loaded.factory(makeRequire());
  plugin.apply(ctx);

  assert.equal(loaded.id, 'dsh-workspace-git-status');
  assert.deepEqual(plugin.inject, ['slots', 'locale']);
  assert.equal(registrations.length, 2);

  const icon = registrations.find(entry => entry.options.name === 'sidebar.panellist');
  assert.equal(icon.options.id, 'workspace-git');
  assert.equal(icon.options.order, 30);
  assert.equal(icon.options.locale, 'workspaceGitStatus');
  assert.equal(icon.options.label(), 'Git 状态');
  assert.equal(typeof icon.component, 'function');

  const panel = registrations.find(entry => entry.options.name === 'main');
  assert.equal(panel.options.key, 'workspace-git');
  assert.equal(panel.options.locale, 'workspaceGitStatus');
  assert.equal(typeof panel.component, 'function');
});

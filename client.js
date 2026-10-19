window.__ModuleLoader__.load({
  id: 'dsh-workspace-git-status',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'workspaceGitStatus';
    const POLL_MS = 5_000;
    const ENDPOINT = '/api/workspace-git/status';
    const ACTION_ENDPOINT = '/api/workspace-git/action';

    const zh = {
      nav: 'Git 状态',
      panelTitle: '工作区 Git 状态',
      panelSubtitle: '每个工作区的分支、未提交改动与领先/落后提交。',
      refresh: '刷新',
      refreshing: '刷新中…',
      loading: '正在读取…',
      empty: '还没有工作区。',
      workspaces: '工作区',
      dirty: '有改动',
      updated: '更新于',
      clean: '干净',
      staged: '已暂存',
      unstaged: '未暂存',
      untracked: '未跟踪',
      conflicts: '冲突',
      detached: '游离 HEAD',
      unborn: '尚无提交',
      notRepo: '非 Git 仓库',
      error: '读取失败',
      gitMissing: '未找到 git 可执行文件，无法读取仓库状态。',
      timeout: '读取超时',
      bareRepo: '裸仓库，没有工作区',
      stageAll: '暂存全部',
      unstageAll: '取消暂存',
      commit: '提交',
      commitPlaceholder: '提交信息',
      fetch: '抓取',
      pull: '拉取',
      push: '推送',
      branch: '分支',
      newBranchPlaceholder: '新分支名',
      create: '创建',
      discard: '丢弃改动',
      discardConfirm: '确认丢弃全部改动？',
      confirm: '确认',
      cancel: '取消',
      actionFailed: '操作失败',
      actionDone: '操作完成',
      branchesEmpty: '没有可用分支',
      expandFiles: '文件',
      collapseFiles: '收起文件',
      noFiles: '没有文件',
    };

    const en = {
      nav: 'Git status',
      panelTitle: 'Workspace Git Status',
      panelSubtitle: "Each workspace's branch, pending changes, and ahead/behind counts.",
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Reading…',
      empty: 'No workspaces yet.',
      workspaces: 'Workspaces',
      dirty: 'Dirty',
      updated: 'Updated',
      clean: 'Clean',
      staged: 'staged',
      unstaged: 'unstaged',
      untracked: 'untracked',
      conflicts: 'conflicts',
      detached: 'Detached HEAD',
      unborn: 'no commits',
      notRepo: 'Not a Git repository',
      error: 'Read failed',
      gitMissing: 'The git executable was not found, so repository status cannot be read.',
      timeout: 'Read timed out',
      bareRepo: 'Bare repository without a work tree',
      stageAll: 'Stage all',
      unstageAll: 'Unstage all',
      commit: 'Commit',
      commitPlaceholder: 'Commit message',
      fetch: 'Fetch',
      pull: 'Pull',
      push: 'Push',
      branch: 'Branch',
      newBranchPlaceholder: 'New branch name',
      create: 'Create',
      discard: 'Discard changes',
      discardConfirm: 'Discard all changes?',
      confirm: 'Confirm',
      cancel: 'Cancel',
      actionFailed: 'Action failed',
      actionDone: 'Done',
      branchesEmpty: 'No branches available',
      expandFiles: 'Files',
      collapseFiles: 'Hide files',
      noFiles: 'No files',
    };

    let t;
    let timer = null;
    let inflight = null;
    let snapshot = { data: null, error: null, refreshing: false };
    const listeners = new Set();

    function publish(patch) {
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) listener();
    }

    function subscribe(listener) {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    }

    function getSnapshot() {
      return snapshot;
    }

    function useGitStatus() {
      return React.useSyncExternalStore(subscribe, getSnapshot);
    }

    function refresh({ force = false, manual = false } = {}) {
      if (manual) publish({ refreshing: true });
      if (inflight) return inflight;

      inflight = fetch(ENDPOINT + (force ? '?force=1' : ''), { headers: { accept: 'application/json' } })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then(data => publish({ data, error: null, refreshing: false }))
        .catch(error => {
          publish({
            error: error instanceof Error ? error.message : String(error),
            refreshing: false,
          });
        })
        .finally(() => {
          inflight = null;
        });

      return inflight;
    }

    function onVisibility() {
      if (!document.hidden) void refresh();
    }

    function onFocus() {
      void refresh();
    }

    function start() {
      if (timer !== null) return;
      void refresh();
      timer = window.setInterval(() => {
        if (!document.hidden) void refresh();
      }, POLL_MS);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('focus', onFocus);
    }

    function stop() {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    }

    function pendingCount(workspace) {
      return workspace.staged + workspace.unstaged + workspace.untracked + workspace.conflicts;
    }

    function dirtyCount(data) {
      if (!data) return 0;
      return data.workspaces.filter(workspace => workspace.state === 'repo' && pendingCount(workspace) > 0).length;
    }

    function rowError(workspace) {
      if (workspace.error === 'timeout') return t('timeout');
      if (workspace.error === 'bare repository') return t('bareRepo');
      return workspace.error;
    }

    function formatTime(iso) {
      const date = new Date(iso);
      return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    async function postAction(workspaceId, body) {
      const response = await fetch(ACTION_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, ...body }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      return result;
    }

    function GitIcon({ size = 20, active = false }) {
      const state = useGitStatus();
      const dirty = dirtyCount(state.data);

      return h(
        'span',
        {
          style: {
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            color: 'currentColor',
            opacity: active ? 1 : 0.82,
          },
        },
        h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: size,
            height: size,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            style: { display: 'block' },
          },
          h('circle', { cx: 6, cy: 5.5, r: 2.2 }),
          h('circle', { cx: 6, cy: 18.5, r: 2.2 }),
          h('circle', { cx: 18, cy: 7, r: 2.2 }),
          h('path', { d: 'M6 7.7v8.6' }),
          h('path', { d: 'M18 9.2c0 3.1-2.4 5-5.7 5.4' }),
        ),
        dirty > 0
          ? h('span', {
              'aria-hidden': true,
              style: {
                position: 'absolute',
                top: 0,
                right: 0,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--dsw-alias-state-warn-primary)',
                boxShadow: '0 0 0 1.5px var(--dsw-specific-sidebar-fill)',
              },
            })
          : null,
      );
    }

    function BranchChip({ workspace }) {
      const label = workspace.detached
        ? `${t('detached')}${workspace.oid ? ` ${workspace.oid.slice(0, 7)}` : ''}`
        : workspace.branch;
      const unborn = workspace.oid === null && !workspace.detached;

      return h(
        'span',
        { className: 'wgs-branch' },
        label || '—',
        unborn ? h('span', { className: 'wgs-branch-note' }, ` · ${t('unborn')}`) : null,
      );
    }

    function Counts({ workspace }) {
      const total = pendingCount(workspace);
      if (total === 0) return h('span', { className: 'wgs-clean' }, t('clean'));

      const chips = [];
      if (workspace.staged) chips.push(h('span', { key: 'staged', className: 'wgs-count wgs-count-staged' }, `${workspace.staged} ${t('staged')}`));
      if (workspace.unstaged) chips.push(h('span', { key: 'unstaged', className: 'wgs-count wgs-count-unstaged' }, `${workspace.unstaged} ${t('unstaged')}`));
      if (workspace.untracked) chips.push(h('span', { key: 'untracked', className: 'wgs-count' }, `${workspace.untracked} ${t('untracked')}`));
      if (workspace.conflicts) chips.push(h('span', { key: 'conflicts', className: 'wgs-count wgs-count-conflict' }, `${workspace.conflicts} ${t('conflicts')}`));

      return h('span', { className: 'wgs-counts' }, chips);
    }

    const FILE_GROUPS = [
      ['staged', 'staged'],
      ['unstaged', 'unstaged'],
      ['untracked', 'untracked'],
      ['conflicts', 'conflicts'],
    ];

    function FileList({ files }) {
      const groups = FILE_GROUPS.map(([key, label]) => {
        const entries = files?.[key] ?? [];
        return entries.length === 0
          ? null
          : h(
              'div',
              { className: 'wgs-file-group', key },
              h('div', { className: 'wgs-file-head' }, `${t(label)} ${entries.length}`),
              h(
                'ul',
                { className: 'wgs-file-items' },
                entries.map((file, index) =>
                  h(
                    'li',
                    { className: 'wgs-file-item', key: `${file.path}:${index}`, title: file.from ? `${file.from} → ${file.path}` : file.path },
                    h('span', { className: 'wgs-file-path' }, file.path),
                    file.from ? h('span', { className: 'wgs-file-from' }, `← ${file.from}`) : null,
                  ),
                ),
              ),
            );
      });

      if (groups.every(group => group === null)) return h('div', { className: 'wgs-actions wgs-file-panel wgs-muted' }, t('noFiles'));
      return h('div', { className: 'wgs-actions wgs-file-panel' }, groups);
    }

    function WorkspaceRow({ workspace, onAction, busy }) {
      const repo = workspace.state === 'repo';
      const [message, setMessage] = React.useState('');
      const [branchName, setBranchName] = React.useState('');
      const [branches, setBranches] = React.useState(null);
      const [confirmDiscard, setConfirmDiscard] = React.useState(false);
      const [showCommit, setShowCommit] = React.useState(false);
      const [showFiles, setShowFiles] = React.useState(false);
      const [feedback, setFeedback] = React.useState(null);

      const run = async body => {
        setFeedback(null);
        try {
          const result = await onAction(workspace.id, body);
          if (body.action !== 'branches') setFeedback({ ok: true });
          if (body.action === 'commit') {
            setMessage('');
            setShowCommit(false);
          }
          if (body.action === 'checkout' || body.action === 'createBranch') {
            setBranches(null);
            setBranchName('');
          }
          return result;
        } catch (error) {
          setFeedback({ ok: false, error: error instanceof Error ? error.message : String(error) });
          return null;
        }
      };

      const openBranches = async () => {
        setFeedback(null);
        try {
          const result = await onAction(workspace.id, { action: 'branches' });
          setBranches(result.branches ?? []);
        } catch (error) {
          setFeedback({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      };

      return h(
        'div',
        { className: 'wgs-row', role: 'listitem' },
        h(
          'div',
          { className: 'wgs-row-main' },
          h('div', { className: 'wgs-row-title' }, workspace.title || workspace.path),
          h('div', { className: 'wgs-row-path', title: workspace.path }, workspace.path),
          repo
            ? h(
                'div',
                { className: 'wgs-actions' },
                h('button', { type: 'button', className: 'wgs-button', disabled: busy, onClick: () => void run({ action: 'stage' }) }, t('stageAll')),
                h('button', { type: 'button', className: 'wgs-button', disabled: busy, onClick: () => void run({ action: 'unstage' }) }, t('unstageAll')),
                h('button', { type: 'button', className: 'wgs-button', disabled: busy, onClick: () => void run({ action: 'fetch' }) }, t('fetch')),
                h('button', { type: 'button', className: 'wgs-button', disabled: busy, onClick: () => void run({ action: 'pull' }) }, t('pull')),
                h('button', { type: 'button', className: 'wgs-button', disabled: busy, onClick: () => void run({ action: 'push' }) }, t('push')),
                h('button', { type: 'button', className: 'wgs-button', disabled: busy, onClick: () => void openBranches() }, t('branch')),
                confirmDiscard
                  ? h(
                      React.Fragment,
                      null,
                      h('span', { className: 'wgs-warn' }, t('discardConfirm')),
                      h('button', { type: 'button', className: 'wgs-button wgs-danger', disabled: busy, onClick: () => { setConfirmDiscard(false); void run({ action: 'discard' }); } }, t('confirm')),
                      h('button', { type: 'button', className: 'wgs-button', onClick: () => setConfirmDiscard(false) }, t('cancel')),
                    )
                  : h('button', { type: 'button', className: 'wgs-button wgs-danger', disabled: busy, onClick: () => setConfirmDiscard(true) }, t('discard')),
                h('button', {
                  type: 'button',
                  className: 'wgs-button wgs-primary',
                  disabled: busy,
                  onClick: () => setShowCommit(value => !value),
                }, t('commit')),
                h('button', {
                  type: 'button',
                  className: 'wgs-button',
                  disabled: busy || pendingCount(workspace) === 0,
                  onClick: () => setShowFiles(value => !value),
                }, showFiles ? t('collapseFiles') : t('expandFiles')),
              )
            : null,
          repo && showFiles
            ? h(FileList, { files: workspace.files })
            : null,
          repo && showCommit
            ? h(
                'div',
                { className: 'wgs-actions wgs-commit-panel' },
                h('input', {
                  className: 'wgs-input',
                  value: message,
                  placeholder: t('commitPlaceholder'),
                  disabled: busy,
                  autoFocus: true,
                  onChange: event => setMessage(event.target.value),
                  onKeyDown: event => {
                    if (event.key === 'Enter' && message.trim()) void run({ action: 'commit', message });
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'wgs-button wgs-primary',
                  disabled: busy || !message.trim(),
                  onClick: () => void run({ action: 'commit', message }),
                }, t('commit')),
              )
            : null,
          repo && branches
            ? h(
                'div',
                { className: 'wgs-actions wgs-branch-panel' },
                branches.length === 0
                  ? h('span', { className: 'wgs-muted' }, t('branchesEmpty'))
                  : branches.map(branch =>
                      h('button', {
                        key: branch,
                        type: 'button',
                        className: branch === workspace.branch ? 'wgs-button wgs-current' : 'wgs-button',
                        disabled: busy || branch === workspace.branch,
                        onClick: () => void run({ action: 'checkout', branch }),
                      }, branch)),
                h('input', {
                  className: 'wgs-input',
                  value: branchName,
                  placeholder: t('newBranchPlaceholder'),
                  disabled: busy,
                  onChange: event => setBranchName(event.target.value),
                }),
                h('button', {
                  type: 'button',
                  className: 'wgs-button wgs-primary',
                  disabled: busy || !branchName.trim(),
                  onClick: () => void run({ action: 'createBranch', branch: branchName }),
                }, t('create')),
              )
            : null,
          feedback
            ? h('div', { className: feedback.ok ? 'wgs-ok' : 'wgs-error' }, feedback.ok ? t('actionDone') : `${t('actionFailed')}: ${feedback.error}`)
            : null,
        ),
        h(
          'div',
          { className: 'wgs-row-meta' },
          repo ? h(BranchChip, { workspace }) : null,
          repo ? h(Counts, { workspace }) : null,
          repo && (workspace.ahead > 0 || workspace.behind > 0)
            ? h('span', { className: 'wgs-sync' }, `↑${workspace.ahead} ↓${workspace.behind}`)
            : null,
          repo ? null : h('span', { className: 'wgs-muted' }, workspace.state === 'not-repo' ? t('notRepo') : `${t('error')}: ${rowError(workspace)}`),
        ),
      );
    }

    function GitPanel() {
      const state = useGitStatus();
      const data = state.data;
      const total = data ? data.workspaces.length : 0;
      const dirty = dirtyCount(data);
      const globalError = data && data.error === 'git-not-found' ? t('gitMissing') : state.error;
      const [busy, setBusy] = React.useState(null);

      const handleAction = async (workspaceId, body) => {
        setBusy(workspaceId);
        try {
          const result = await postAction(workspaceId, body);
          if (body.action !== 'branches') await refresh({ force: true });
          return result;
        } finally {
          setBusy(null);
        }
      };

      return h(
        'div',
        { className: 'wgs-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'wgs-head' },
          h(
            'div',
            null,
            h('h1', { className: 'wgs-title' }, t('panelTitle')),
            h('p', { className: 'wgs-subtitle' }, t('panelSubtitle')),
          ),
          h(
            'div',
            { className: 'wgs-head-actions' },
            data ? h('span', { className: 'wgs-summary' }, `${t('workspaces')} ${total} · ${t('dirty')} ${dirty}`) : null,
            h(
              'button',
              {
                type: 'button',
                className: 'wgs-button',
                disabled: state.refreshing,
                onClick: () => void refresh({ force: true, manual: true }),
              },
              state.refreshing ? t('refreshing') : t('refresh'),
            ),
          ),
        ),
        globalError ? h('div', { className: 'wgs-banner', role: 'alert' }, globalError) : null,
        !data && !globalError ? h('div', { className: 'wgs-empty' }, t('loading')) : null,
        data && data.workspaces.length === 0 && !globalError ? h('div', { className: 'wgs-empty' }, t('empty')) : null,
        data && data.workspaces.length > 0
          ? h(
              'div',
              { className: 'wgs-list', role: 'list' },
              data.workspaces.map(workspace =>
                h(WorkspaceRow, {
                  key: workspace.id,
                  workspace,
                  onAction: handleAction,
                  busy: busy === workspace.id,
                }),
              ),
            )
          : null,
        data ? h('div', { className: 'wgs-foot' }, `${t('updated')} ${formatTime(data.scannedAt)}`) : null,
      );
    }

    const CSS = `
      .wgs-root {
        height: 100%;
        min-height: 0;
        overflow: auto;
        box-sizing: border-box;
        padding: 28px 32px 40px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
      }
      .wgs-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 20px;
      }
      .wgs-title {
        margin: 0 0 6px;
        font-size: 18px;
        font-weight: 600;
        line-height: 1.3;
      }
      .wgs-subtitle {
        margin: 0;
        font-size: 13px;
        color: var(--dsw-alias-label-secondary);
      }
      .wgs-head-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
      }
      .wgs-summary {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        white-space: nowrap;
      }
      .wgs-button {
        font: inherit;
        font-size: 12px;
        padding: 6px 12px;
        border-radius: 7px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        cursor: pointer;
      }
      .wgs-button:hover:not(:disabled) {
        background: var(--dsw-alias-bg-layer-2);
      }
      .wgs-button:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .wgs-button.wgs-primary {
        border-color: var(--dsw-alias-brand-primary);
        color: var(--dsw-alias-brand-primary);
      }
      .wgs-button.wgs-danger {
        border-color: var(--dsw-alias-state-error-primary);
        color: var(--dsw-alias-state-error-primary);
      }
      .wgs-button.wgs-current {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-bg-layer-2);
      }
      .wgs-banner {
        margin: 0 0 16px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-state-error-primary);
        color: var(--dsw-alias-state-error-primary);
        font-size: 13px;
      }
      .wgs-empty {
        padding: 32px 0;
        text-align: center;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
      }
      .wgs-list {
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
        overflow: hidden;
      }
      .wgs-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        padding: 14px 16px;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .wgs-row:first-child {
        border-top: 0;
      }
      .wgs-row-main {
        min-width: 0;
        flex: 1;
      }
      .wgs-row-title {
        font-size: 13px;
        font-weight: 600;
        line-height: 1.4;
      }
      .wgs-row-path {
        margin-top: 3px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 52vw;
      }
      .wgs-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
      }
      .wgs-commit {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 1 1 220px;
        min-width: 160px;
      }
      .wgs-input {
        font: inherit;
        font-size: 12px;
        flex: 1;
        min-width: 80px;
        padding: 5px 8px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
      }
      .wgs-input:focus {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 1px;
      }
      .wgs-commit-panel,
      .wgs-branch-panel,
      .wgs-file-panel {
        padding-top: 8px;
        border-top: 1px dashed var(--dsw-alias-border-l1);
      }
      .wgs-file-panel {
        display: block;
      }
      .wgs-file-group + .wgs-file-group {
        margin-top: 8px;
      }
      .wgs-file-head {
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
        margin-bottom: 4px;
      }
      .wgs-file-items {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 220px;
        overflow: auto;
      }
      .wgs-file-item {
        display: flex;
        align-items: baseline;
        gap: 8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        line-height: 1.7;
        padding: 0 4px;
      }
      .wgs-file-path {
        color: var(--dsw-alias-label-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .wgs-file-from {
        color: var(--dsw-alias-label-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .wgs-row-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
        flex-shrink: 0;
      }
      .wgs-branch {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
        white-space: nowrap;
      }
      .wgs-branch-note {
        color: var(--dsw-alias-label-secondary);
      }
      .wgs-counts {
        display: inline-flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .wgs-count {
        font-size: 11px;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        white-space: nowrap;
      }
      .wgs-count-staged {
        color: var(--dsw-alias-state-success-primary);
        border-color: currentColor;
      }
      .wgs-count-unstaged {
        color: var(--dsw-alias-state-warn-primary);
        border-color: currentColor;
      }
      .wgs-count-conflict {
        color: var(--dsw-alias-state-error-primary);
        border-color: currentColor;
      }
      .wgs-clean {
        font-size: 11px;
        color: var(--dsw-alias-state-success-primary);
      }
      .wgs-sync {
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
        white-space: nowrap;
      }
      .wgs-muted {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .wgs-warn {
        font-size: 11px;
        color: var(--dsw-alias-state-error-primary);
      }
      .wgs-error {
        margin-top: 8px;
        font-size: 12px;
        color: var(--dsw-alias-state-error-primary);
      }
      .wgs-ok {
        margin-top: 8px;
        font-size: 12px;
        color: var(--dsw-alias-state-success-primary);
      }
      .wgs-foot {
        margin-top: 10px;
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
      }
    `;

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-workspace-git-status: dictionaries');
      t = ctx.locale.bind(NS);

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'workspace-git',
            order: 30,
            label: () => t('nav'),
            locale: NS,
          },
          GitIcon,
        ),
      );

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'workspace-git',
            locale: NS,
          },
          GitPanel,
        ),
      );
    }

    return { inject: ['slots', 'locale'], apply };
  },
});

/**
 * Host 侧入口：把工作区 Git 状态暴露成一个只读路由，Client 面板消费它。
 */

import { API_PREFIX, createApi, createStatusService } from './src/host/status.js';

export const inject = ['workspaceRegistry', 'subprocess', 'webServer'];

export function apply(ctx) {
  const api = createApi(createStatusService(ctx));
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: api,
      }),
    'dsh-workspace-git-status: HTTP API',
  );
}

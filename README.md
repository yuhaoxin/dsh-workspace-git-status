# dsh-workspace-git-status

DeepSeek Harness 插件：在左侧栏查看每个工作区的 Git 仓库状态。

左侧栏新增一个 Git 图标，有未提交改动的工作区存在时显示小圆点。点开后在主区列出所有已登记工作区，逐个显示分支、已暂存/未暂存/未跟踪文件数和领先/落后提交数。插件只读，不执行 stage、commit、push、checkout 等写操作。

## 安装

需要支持 `dsh.client` 的 DeepSeek Harness 0.2.1 或更新版本，profile 里有 `workspaceRegistry`、`subprocess`、`webServer` 三个 Host 服务。

从 GitHub 安装：

```bash
dsh plugin --profile desktop add github:yuhaoxin/dsh-workspace-git-status
```

从本地目录安装（开发时）：

```bash
git clone https://github.com/yuhaoxin/dsh-workspace-git-status.git
cd dsh-workspace-git-status
dsh plugin --profile desktop add "$PWD"
```

把 `desktop` 换成实际使用的 profile。安装后刷新 DSH 窗口；如果左侧栏没有出现 Git 图标，重启 DSH。

## 使用

- 左侧栏底部的 Git 图标打开面板。
- 图标右上角的小圆点表示至少一个工作区有未提交改动。
- 面板里每一行是一个工作区：名称、绝对路径、当前分支、改动计数、领先/落后提交数。
- 非 Git 目录显示“非 Git 仓库”；读取失败的行显示具体错误。

## 状态口径

| 字段 | 含义 |
| --- | --- |
| 分支 | 当前 HEAD 的分支名；游离 HEAD 显示短 oid；尚无提交时标注“尚无提交” |
| 已暂存 | porcelain v2 中 XY 位的 X 不为 `.` 的条目 |
| 未暂存 | XY 位的 Y 不为 `.` 的条目 |
| 未跟踪 | `?` 条目 |
| 冲突 | `u` 条目，单独计数，不重复计入已暂存/未暂存 |
| 领先/落后 | 仅在有 upstream 且数字非零时显示 |

## 刷新与安全

- 页面可见时每 5 秒读取一次；页面隐藏时暂停；窗口重新聚焦时立即刷新；面板里有手动刷新按钮。
- 路由只接受回环地址请求。通过远程地址打开 DSH 时，面板不会拿到工作区路径或状态。
- git 以数组参数启动，不经过 shell；只运行 `git status`。
- 按工作区路径本身计算，不向上找父仓库，不递归子仓库。

## 已知限制

- 状态在独立面板里，不内联到左侧工作区列表的每个工作区标题。后者需要替换宿主的工作区浏览区。
- 不提供任何 Git 写操作，也没有提交历史或提交图。
- 所有工作区共用 5 秒轮询；工作区很多或仓库很大时，单轮扫描可能变慢，没有自适应频率或并发上限。
- 同一仓库被多个工作区引用时分别显示，不合并。

## 开发

不需要构建步骤：`client.js` 就是提交进仓库的客户端模块，`index.js` 与 `src/host/**` 是 Host 代码。

```bash
node --test test/          # 解析与子进程映射的测试
dsh plugin --profile desktop add "$PWD"
```

修改 `client.js` 后刷新页面；修改 `index.js` 或 `src/host/**` 后需要重启 DSH 进程。

## 许可

MIT

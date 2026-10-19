# dsh-workspace-git-status

DeepSeek Harness 插件：在左侧栏查看并操作每个工作区的 Git 仓库。

左侧栏新增一个 Git 图标，有未提交改动的工作区存在时显示小圆点。点开后在主区列出所有已登记工作区，逐个显示分支、已暂存/未暂存/未跟踪文件数和领先/落后提交数。每行可以暂存全部、取消暂存、提交、抓取、拉取、推送、切换/新建分支，以及丢弃全部改动。

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
- 行内按钮：暂存全部、取消暂存、抓取、拉取、推送、分支、提交、丢弃改动。
- “提交”展开输入框，回车或点提交；成功后输入框收起并刷新状态。
- “分支”展开本地分支列表，点一个切换；在输入框里填新名字后点“创建”新建并切换。
- “丢弃改动”需要再点一次“确认”，执行 `git reset --hard HEAD` 和 `git clean -fd`。

## 状态口径

| 字段 | 含义 |
| --- | --- |
| 分支 | 当前 HEAD 的分支名；游离 HEAD 显示短 oid；尚无提交时标注“尚无提交” |
| 已暂存 | porcelain v2 中 XY 位的 X 不为 `.` 的条目 |
| 未暂存 | XY 位的 Y 不为 `.` 的条目 |
| 未跟踪 | `?` 条目 |
| 冲突 | `u` 条目，单独计数，不重复计入已暂存/未暂存 |
| 领先/落后 | 仅在有 upstream 且数字非零时显示 |

## 操作与安全

- 暂存使用 `git add --all`；取消暂存使用 `git reset`；提交使用 `git commit -m`。
- 抓取使用 `git fetch --prune`；拉取使用 `git pull --ff-only`，不能快进时直接报错，不会产生合并提交；推送使用 `git push`。
- 分支列表来自 `git branch --format=%(refname:short)`；切换使用 `git checkout <branch>`；新建使用 `git checkout -b <branch>`。
- 丢弃改动是破坏性操作：`git reset --hard HEAD` 之后紧跟 `git clean -fd`，未跟踪文件与目录会被删除。界面需要二次确认。
- 所有写操作按工作区串行执行，避免同一仓库的并发写冲突。
- 写操作路由只接受回环地址、同源 `Origin` 和 `application/json`，并且只允许上面列出的动作；git 以数组参数启动，不经过 shell。

## 刷新

- 页面可见时每 5 秒读取一次；页面隐藏时暂停；窗口重新聚焦时立即刷新；面板里有手动刷新按钮。
- 操作成功后立即强制刷新一次，不等下一轮轮询。

## 已知限制

- 状态在独立面板里，不内联到左侧工作区列表的每个工作区标题。后者需要替换宿主的工作区浏览区。
- 没有提交历史、提交图、冲突解决界面、rebase 或 cherry-pick。
- 丢弃改动会删除未跟踪文件，没有回收站。
- 所有工作区共用 5 秒轮询；工作区很多或仓库很大时，单轮扫描可能变慢，没有自适应频率或并发上限。
- 同一仓库被多个工作区引用时分别显示、分别操作，不合并。

## 开发

不需要构建步骤：`client.js` 就是提交进仓库的客户端模块，`index.js` 与 `src/host/**` 是 Host 代码。

```bash
node --test test/          # 解析、动作参数、真实仓库操作与路由守卫
dsh plugin --profile desktop add "$PWD"
```

修改 `client.js` 后刷新页面；修改 `index.js` 或 `src/host/**` 后需要重启 DSH 进程。

## 许可

MIT

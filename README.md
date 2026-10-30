# dsh-restart

重启整个 DeepSeek Harness 进程的插件，用于重新加载插件与配置（profile 的 cordis 组合、settings 等）。host + client 双半，装进 profile 的 bundle 后即可用。

## 上游来源

本仓库派生自 [`anweat/dsh-restart`](https://github.com/anweat/dsh-restart)（MIT），基线版本 `0.1.3-alpha.5`。

**Git 关联方式**：本地仓库是独立 `git init`（与上游无共同祖先），因此**不能 `git merge upstream`**——会变成整树冲突。已配置的用法是「只读参考」：

```bash
git remote add upstream https://github.com/anweat/dsh-restart.git
git fetch upstream
git diff upstream/HEAD --stat        # 本地相对上游改了什么
git show upstream/HEAD:src/index.ts  # 直接读上游某个文件
```

**本地相对上游的两类改动**：

| 类别 | 载体 |
|---|---|
| 运行期改造（launchd 重启路径、设置卡片） | `patches/local-launchd-and-configforms.patch`，外加 `src/` 与 `lib/` 的对应改动 |
| 本地文档与展示资源 | `README.md`、`locale/`、`icon.svg` |

**同步上游的做法**：先 `git fetch upstream`，用 `git diff upstream/HEAD -- src/` 看上游改了什么，再把需要的改动按需重放到本地 `src/` 与 `lib/`，不要 merge。

> 注意：上游带 `tsconfig.json` / `tsdown.config.ts` / `tests/` / `scripts/`，本仓库此前未同步这些工程文件。直接跑 `pnpm run build` 会先删除 `lib/`，配置缺失时构建失败并留下空 `lib/`——**改动前先备份或先确认构建链可用**。

![DSH 重启插件设置](./docs/images/dsh-restart-settings.png)

> 截图来自真实 `web` profile 部署，展示当前 DSH 设置页中的重启配置卡片。

## 功能

- **模型工具 `restart_harness`**：让 agent 直接安排一次进程重启（可选 `delayMs`）。
- **`/restart` 斜杠命令**：在 UI 里手动触发重启。
- **配置卡片**（设置 → 插件 → 插件配置 → 「DSH 重启」）：可视化编辑以下设置，改动即时写入 `settings.yaml`：
  - `legacyRestart` — 旧 PowerShell/WMI/taskkill 重启方式（默认关闭，用 Node 原生方式）。
  - `continuePrompt` — 重启后自动继续时注入给 agent 的提示词。
- **「立即重启」按钮**：先读取当前进程身份，安排重启后等待新进程恢复并自动刷新页面。只读 GET 返回 `{ pid, startedAt }`；出于安全考虑，重启 POST 仍仅接受来自环回地址（127.0.0.1 / localhost）的同源请求，经反向代理/远程访问时会被拒绝（403）。

> 自 `0.1.3-alpha.4` 起，内置 detached watchdog 已停用并从设置卡片移除。旧
> `watchdog*` 配置仍可被读取但不会执行；进程异常恢复请交给 systemd、Windows
> 服务或其他拥有完整进程生命周期的外部管理器。插件启动时会保留
> `$DSH_HOME/dsh-stop.flag`，让旧版本遗留的 detached watchdog 自行退出。

## 兼容与发布通道

| 插件发布通道 | DSH 基线 | 兼容承诺 |
|---|---|---|
| npm `latest`（当前正式发布插件） | `dsh-v0.1.1-rc.2` | 已验证维护基线 |
| npm `next` 候选（`0.1.3-alpha.5`） | `dsh-v0.1.5-alpha.1` | 精确依赖与真实 profile 验收目标 |
| 后续 DSH 正式版 | 尚未发布 | 发布并完成真实 profile 门禁后再声明兼容 |

开发版不会覆盖 npm `latest`。`0.1.5-alpha.1` 依赖按精确版本锁定；该版本已移除
`@deepseek-ai/dsh-client-runtime`，客户端契约分别迁移到 Cordis、
`dsh-client-store` 与 `dsh-client-ui-settings`，不会混装 rc.2 运行时。

### `0.1.3-alpha.4` 变更

- 禁用并移除内置 detached watchdog；旧配置保留为无操作兼容项。
- Windows 重启通过隐藏控制台拉起，保留完整 argv，避免后续 sandbox 命令闪窗。
- 新进程 PID 变化后继续等待带认证的前端首页返回成功，再刷新页面，避免源码部署
  重启期间因静态前端尚未挂载而停留在 HTTP 404。
- 防止并发请求重复安排 helper；helper 创建失败时保留旧进程，并记录失败日志。
- 自动继续投递失败时保留恢复标记；Web 路由随 Cordis 生命周期正确释放。

### 源码部署排错

- 本开发分支只对齐官方标签 `dsh-v0.1.5-alpha.1`。源码 checkout 先执行
  `corepack pnpm install --frozen-lockfile` 和 `corepack pnpm run build`，再把本地插件
  重新加入隔离 profile；只安装依赖但没有构建 workspace，会表现为缺少
  `@deepseek-ai/*/lib`，并不是 restart 拉起失败。
- 如果页面显示 `list slot "settings.plugin.item" requires options.id`，说明 Harness
  与插件客户端落在不同的开发期 slot 契约。`0.1.5-alpha.1` 的官方契约是 keyed slot，
  本插件必须使用 `options.key`；不要直接改成 `id`，应统一 Harness 标签、插件分支
  和 profile 锁文件后重装。
- pnpm 首次安装 profile 依赖时可能把原生包写成待决的 `allowBuilds` 项。逐项确认
  `true` 或 `false` 后重跑 `dsh plugin --profile <name> add ...`，不要用全局放行绕过。
- 若旧版本重启后已经停在浏览器 HTTP 错误页，请手工打开新进程日志打印的当前
  `dsh web:` URL 完成一次恢复；升级到本版本后，设置卡片会等待首页真正就绪再刷新。

## 安装

1. 把包加入 profile 依赖并挂进 bundle：

```jsonc
// profiles/<profile>/package.json
{
  "dependencies": { "dsh-restart": "..." },
  "dsh": { "profile": { "bundles": ["...", "dsh-restart"] } }
}
```

2. 重启 DSH（`/restart` 或 `restart_harness`），刷新页面后即可看到卡片；之后通过卡片重启时会自动等待并恢复页面。

## 构建

```bash
pnpm install
node scripts/link-dsh-workspace.mjs --source <path-to-deepseek-harness>
pnpm run build
```

host 半由 `tsc` 输出到 `lib/index.js`（`@deepseek-ai/*` 保持外部依赖）；client 半由 `tsdown` 打成单文件 `lib/client.js`。

## Model Experience

### Restart the DSH process from the agent or the UI

#### What the model sees

The host half registers one model-callable tool, `restart_harness`, with an
optional `delayMs`. Calling it schedules a full process restart and returns
immediately; the model does not wait for the process to come back. The client
half adds a `/restart` slash command and a 「立即重启」 button in the plugin
settings card, so a human can trigger the same path from the UI.

After the new process is up, the plugin injects a continuation prompt
(`continuePrompt`, default 「（系统已重启完成）请继续之前未完成的工作。」) so
the agent resumes the interrupted work instead of starting cold.

#### Token effect

Independent — a restart is a process event, not a prompt prefix. The
continuation prompt is appended once after the new process starts, and the
session prefix is not reused across the restart boundary.

#### KV Cache effect

Broken at the restart boundary by design. The new process rebuilds its own
session and prompt prefix, so the pre-restart prefix cannot be reused; the
continuation prompt starts a fresh prefix.

## Known Limitations and Deferred Work

- **launchd 冲突已由本机补丁解决** — 上游原生路径是「派生 detached helper
  抢端口」, 在 launchd `KeepAlive` 托管的 web profile 上会与宿主争抢 3080。
  本机补丁在检测到 launchd 托管时改走 `launchctl kickstart -k`, 不再派生任何
  替代进程, 与 `dsh-web-restart` 同源。判据是进程环境里的
  `XPC_SERVICE_NAME`(launchd 派生的进程必带), 比「探 launchctl print 是否存在
  该 label」更准 —— 后者在进程并非由该 label 拉起时会误判。
  非 launchd 环境(手工拉起的常驻进程)仍走原生 detached helper 路径。
- **kickstart 失败会退回原生路径** — 若 `launchctl kickstart` 报错, 插件退回
  自派生 helper 以免完全无法重启; 此时才会出现与 launchd 抢端口的风险。
- **重启即中断** — `restart_harness` 立即返回, 正在执行的工具调用与子进程会被
  宿主终止; 需要等待结果的场景要先落盘。
- **launchd 路径下「安排成功」日志不落盘** — `launchctl kickstart -k` 会把当前进程
  SIGKILL 掉(launchd 记录的 last exit status 为 `-9`), 而 `spawnSync` 正阻塞在
  等 launchctl 返回, 进程在写 `launchd kickstart scheduled` 之前就死了, 该行
  不会出现在 `~/.dsh/dsh-restart-auto.log`。这是预期行为, 不是失败信号 ——
  判断重启是否成功应看 launchd 的 pid/状态与 `dsh-web status`, 不看这行日志。
  同理, 走 HTTP 路由触发时客户端拿不到 202 响应, 连接会直接被掐断。
- **continuePrompt 依赖 resume marker** — 自动继续依赖写在本机磁盘上的恢复
  标记; 标记丢失或超过 `resumeMaxAgeMs`(默认 2 小时)后不再自动继续。
- **本机补丁** — `lib/client.js` 与 `lib/index.js` 带本地 pnpm patch: 改用
  `ctx.configForms.get("dsh-restart")` 取配置作用域, 并导出 `Config` schema
  供宿主投影表单; 补丁与包一同恢复, 脱离该补丁时设置卡片不渲染。
- **上游基线** — 基底为上游 `0.1.3-alpha.5`; 上游 alpha.4→alpha.5 的
  `lib/*.js` 仅有换行符差异(CRLF→LF), 逻辑未变, 本地补丁在其上原样保留。

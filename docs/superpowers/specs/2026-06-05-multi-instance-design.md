# 多实例并发设计:自动端口 + 每项目 runtime 发现

日期:2026-06-05
状态:已与用户对齐(方案 A + 审查修补)

## 问题

falinks 同一时间只能跑一个办公室:

1. **端口写死**:`cfg.busPort`(默认 7878),`EADDRINUSE` 直接 `process.exit(1)`(`src/bus/server.ts:214`)。
2. **runtime.json 全局唯一**:`~/.falinks/runtime.json` 只记一个 `{port}`,第二个实例覆盖第一个。
3. **发现机制依赖它**:`falinks say/broadcast/roster/log`(`src/cli.ts`)和窗口回退模式的控制台(`src/console/main.tsx`)都靠它找总线。

员工侧无障碍:MCP 配置每次启动写临时文件、直接带 `bus.port`,端口动态化对其透明。
`startBus` 已从 `httpServer.address()` 读真实端口,`listen(0)` 自动分配天然可用。

## 设计

### 1. 端口分配(src/core/config.ts、src/bus/server.ts)

- `busPort` 改为**可选**。未配置 → `listen(0)` 系统分配。
- 显式配置但被占用 → **警告并回退自动分配**,不再 `process.exit(1)`。
- 新生成的默认配置(`src/cli.ts` 的 `writeDefaultConfig`)与团队模板(`src/templates.ts` 的 `configFromMembers`)**不再写 busPort**。
- 存量配置里的 `busPort: 7878` 不做魔法特判:照常尝试,被占即回退,多一行提示。
- 警告呈现:单窗口模式下启动后立刻清屏渲染控制台,stderr 会被吞——警告作为控制台首条 status 显示;非控制台模式照旧打 stderr。

### 2. 每项目 runtime 文件(src/runtime.ts)

- `~/.falinks/runtime.json` → `~/.falinks/runtime/<projectKey>.json`。
- `projectKey(cwd) = sha1(realpathSync(cwd)).hex.slice(0,16)`,抽成共用工具函数——**启动方和所有查找方必须用同一实现**(与 sessions/messages 的既有 hash 模式一致;realpath 防符号链接路径对不上)。
- 内容:`{ port, pid, cwd, startedAt }`(cwd 为 realpath 后的)。
- 写入用 `wx` 排他创建,失败再走探活判断(挡同目录双开竞态,窗口期毫秒级,接受)。
- 退出清理:`process.on('exit')` 同步 unlink + SIGINT/SIGTERM 处理;kill -9 留下的尸体由探活兜底。
- 一次性迁移:启动时顺手删旧的全局 `~/.falinks/runtime.json`。

### 3. 身份核对(防端口复用劫持)(src/bus/server.ts)

- 总线新增 `GET /admin/info` → `{ cwd, pid, startedAt }`。
- 所有"按 runtime 文件找端口"的路径必须探活 `/admin/info` 并**核对 cwd 一致**才算命中;不一致按 stale 处理。
- 场景:项目 A 崩溃(端口 50001 的 runtime 没清),项目 B 启动恰好分到 50001——无核对则 A 目录的 `falinks say` 会发进 B 的办公室。

### 4. 探活语义(三态,不是二态)

| 探活结果 | 判定 | 动作 |
|---------|------|------|
| 200 且 cwd 一致 | 活着,是本项目 | 命中 |
| `ECONNREFUSED` / cwd 不一致 | 确认死亡 / 张冠李戴 | stale:删文件、可覆盖 |
| 超时 / 其他错误 | **状态不明** | 启动场景:拒绝并提示"确认没在运行可删 `<路径>`";查找场景:跳过 |

探活用短超时 fetch(~500ms,AbortController)。

### 5. 同目录防双开(src/index.ts)

启动时若本项目 runtime 文件存在:探活——活着 → 报错退出「该目录已有 falinks 在运行(端口 X)」;确认死亡 → 覆盖。sessions/messages 按 cwd 共享,同目录双开必然互相污染,必须阻止。

### 6. 消费方寻址

- **窗口回退控制台**:不走发现。`consoleLaunchCommand` 改为生成 `… console --port <实际端口>`(`startBus` 先于开窗完成,端口已知);`falinks console` 子命令解析 `--port`,无参时回退 cwd 发现(兼容手动调用)。
- **CLI 子命令**(say/broadcast/roster/log):
  1. 当前 cwd 的 runtime(探活+核对)→ 命中即用;
  2. 否则扫 `~/.falinks/runtime/` 全部文件,逐个探活:恰好一个活的 → 用它(保住"任意目录 `falinks roster`"的旧体验);多个 → 列出各自 cwd 报错提示;零个 → 现有报错文案。
  3. 扫描时顺手删确认死亡的 stale 文件(自愈)。

## 错误处理

- runtime 文件 JSON 损坏 → 按不存在处理(与 loadStore 的容错一致)。
- 探活 fetch 异常一律不抛到用户,归入三态表。
- `wx` 写入失败 → 重新探活,活着即报双开错误。

## 测试

- `tests/runtime.test.ts`:projectKey 的 realpath/hash;runtime 文件读写删。
- `tests/bus/`:`/admin/info` 返回内容;占用端口时回退自动分配(起两个 bus,第二个 explicit 同端口,断言警告回调+实际端口不同)。
- 寻址逻辑:抽纯函数(传入 fetch stub + 文件列表),覆盖三态表与"恰好一个/多个/零个"分支。
- 防双开:同 key 文件存在 + 探活 stub 三态,断言三种动作。
- 全量回归 `npm test` + `npm run build`。

## 影响面

`src/runtime.ts`、`src/bus/server.ts`、`src/index.ts`、`src/cli.ts`、`src/console/main.tsx`、`src/core/config.ts`、`src/templates.ts`、相关 tests、README/CHANGELOG。

## 接受的限制

- 同目录双开竞态窗口(毫秒级,`wx` 已收窄)。
- 子目录执行 `falinks say` 不命中本项目(与 sessions 行为一致),靠"全局唯一活实例"回退兜常见场景。
- 多实例 osascript 轮询压力(每实例 1.5s):已有连续 3 次去抖,列入真机验证项,不预先优化。

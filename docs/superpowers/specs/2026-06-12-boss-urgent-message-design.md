# boss 插队消息(! 前缀直送)— 设计文档

日期:2026-06-12
类型:功能(下个版本)
背景:员工忙时所有消息进 inbox 排队等空闲才 pump,boss 的紧急纠偏(如"方向错了停下")也要等几分钟。Claude Code/codex 都支持生成中键入(输入缓冲、回车后作为当前回合的追加输入,模型当成中途 steering)——人工去 pane 打字就是这么打断的,把它系统化。

## 语义

- **语法**(已选定):输入**句首 `!`** = 插队——`!@lead 改方向` 插队私聊、`!纯文本` 插队回复上次目标、`!@all …` 插队群发;
- **直送**:跳过队列直接注入目标 pane,不管忙闲。忙时 = 写进 CLI 输入缓冲并回车,模型当前回合即可见;闲时与普通发送等价(照常置 busy);
- **权利边界**:仅 boss(控制台//admin/say//admin/broadcast)可插队;员工 `sendmsg` 一律照旧排队;
- **不动现有队列**:已排队消息保持原序(之后照常 pump);插队不撤回旧消息(要撤有 Esc 取消排队);
- **排队消息提升直送**(用户追加):取消排队浮层(Esc 打开)内,选中某条后按 **`!`** = 把这条从队列里取出立即直送(与句首 `!` 语法呼应);Enter 取消语义不变。提示行变为「↑↓ 选 · Enter 取消 · ! 插队直送 · Esc 关闭」。提升后该条按 urgent 渲染(⚡ 直送);
- **护栏**:限流(allowInjection)仍生效——插队不能变成注入风暴;turn-cap/loop 照旧(boss 每条新 thread,本就不撞);
- **呈现**:消息流该条标 **⚡ 直送**(代替 ⏳/✓ 位置的徽标);`!` 后跟 `/` 命令(如 `!/todo`)报错「插队仅用于消息」。

## 实现要点

- `src/console/parse.ts`:句首 `!`(trim 后)→ 剥掉后按原逻辑解析余文;结果为 say/reply/broadcast → 加 `urgent: true`;结果为命令/错误 → 报错 usageUrgent。注意与路径守卫共存(`!` 分支在 `/` 分支之前);
- `src/core/router.ts`:`send(from, to, body, opts?: { urgent?: boolean })`——urgent 且目标非 dead:绕过 inbox 直接 `deliverer.deliver`(目标忙时**不**改其状态机:status 保持 busy、不动 handling;闲时走原 pump 等价路径置 busy);消息对象加 `urgent?: true` 入流水;
- `src/core/router.ts`:新增 `promoteQueued(id)`——按 id 全员查 inbox(对照 `cancelQueued`),命中则 splice 出队并按 urgent 路径直送,消息补 `urgent: true` 标记;已投出/不存在返回 `ok:false`;
- **A-2 兼容(关键)**:直送会更新 `lastDeliverAt`(deliverer 包装层),员工若在忙、把插队内容并入当前回合处理后自动降闲且未调工具——不应记哑巴嫌疑(它可能在 sendmsg 之前就被打断节奏)。取舍:插队投递**不更新** lastDeliverAt(deliverer 包装层按 msg.urgent 跳过记录),A-2 只对排队投递负责——保守不误报;
- `src/bus/server.ts`:`/admin/say`、`/admin/broadcast` 透传 `urgent`;新增 `/admin/promote { id }` → `router.promoteQueued`;
- `src/console`:发送路径带 urgent;取消排队浮层加 `!` 键(POST /admin/promote,成功后本地把该条标 `queued:false, urgent:true`);log-format 渲染 ⚡ 徽标(queued 判定:urgent 消息从不入 inbox,天然不显示 ⏳);
- i18n:usageUrgent、帮助行补 `!` 说明、⚡ 徽标文案、浮层提示行加「! 插队直送」、promote 成功/失败提示。

## 测试要点

- parse:`!@lead x` / `!文本` / `!@all x` → urgent:true;`! /todo` 与 `!/todo` 报错;`!` 单独 → 报错;路径守卫不受影响(`!/var/...` 报错合理——插队消息不该以命令形态开头?注:`!/var/x.png 描述` 是插队发路径,余文解析走路径守卫 → reply → urgent ✓ 需测);
- router:urgent+目标 busy → 立即 deliver 且 inbox 不变、状态仍 busy;urgent+idle → 等价普通发送;urgent+dead → 拒绝;限流拦截仍生效;urgent 不更新 lastDeliverAt(A-2 不记);
- promoteQueued:排队中 → 出队+直送+标 urgent;已投出/不存在 → ok:false;目标忙/闲两态;直送后 queuedIds 不再含该 id;
- console:⚡ 渲染;浮层 `!` 键路径;
- 实机:lead 忙时 `!@lead`,确认文字进 pane 输入缓冲并提交、本回合内被处理。

## 有意不做

- 不做"插队并清空旧队列"(Esc 取消排队已有);不开放给员工;不做优先级分级(YAGNI)。

## 实现后记(2026-06-12)

- 与原设计的偏差(实现时定):① urgent 投递**照常更新** lastDeliverAt——闲时直送依赖投递宽限防过早自动降闲+排队消息交错注入;A-2 误报需连续 2 次且任意 MCP 调用自愈,风险可接受。② 目标 launching 时直送退化为正常排队(消息不标 urgent),promoteQueued 拒绝——pane 未就绪直送必丢。
- 审查追加的防护:③ `hold()`(/clear 保护窗口)的"假忙"同样禁直送——AgentRuntime 加 `holding` 标志,urgent 退化排队、promote 拒绝(reason not-ready),register/onIdle/markLaunching 清除;④ promoteQueued 返回 `reason: 'gone'|'not-ready'|'dead'` 供透传;⑤ deliverUrgent 闲时路径改为 `inbox.unshift + pump` 复用,"闲时等价 pump"由代码保证。
- parse 边界(审查发现):剥首个 `!` 后余文仍以 `!` 开头则当字面文本直送(防 `!!文本` 吞字面 ! + 超长前导 ! 递归爆栈崩控制台);全角 `！` 同认(中文输入法应急场景)。
- 控制台浮层乐观更新改函数式 setLog + 置空 lastSeen 强制重同步(消"在途轮询先落地→旧闭包覆盖→去重卡死陈旧态"竞态,连既有 cancel 分支一并修);pending 改 useMemo 派生;⚡/✗ 标记 liveById 查不到时回退 committed 快照(100 条窗口挤出不丢标)。
- promote 事后补标的 urgent 不回写持久化历史(重启后旧消息不显示 ⚡)——纯显示标记,可接受。

# P1 收件箱合并投递(Inbox Coalescing)设计稿

> 目标:员工空闲轮到时,把收件箱里**所有排队消息合并成一轮**送达,使其针对"当前全貌"作答,消除"逐条回最旧消息"导致的错位(消息交叉)。boss 已选 P1 优先。本稿为实现契约。

## 1. 现状(file:line)

- `inbox: Message[]` per agent(core/types.ts:26)。
- `pump()`(core/router.ts:259-267):`status==='idle'` 时 `inbox.shift()` **一条** → set busy → `handling=msg.thread`、`handlingFrom=msg.from` → `deliver(msg)`。
- `onIdle()`→`pump()`;`send()`→`inbox.push`→`pump()`。
- 投递:orchestrator `makeDeliverer().deliver(msg)` → `driver.inject(formatMessage(msg))`(orchestrator.ts:7-9,25)。
- **guards(loop/turn-cap/rate-limit)在 `send` 时判定**(guards.ts;router.ts:85-95),与投递无关。

→ 头号错位根因:轮到时只取**最旧一条**作答,发送方早已推进。

## 2. 改动

1. **`router.pump()` 批量 drain**:把 `inbox.shift()` 一条改为**取全部**:
   ```
   if (agent.status !== 'idle') return;
   const batch = agent.inbox.splice(0);     // 取走当前全部排队消息
   if (batch.length === 0) return;
   agent.status = 'busy';
   // 线程续接/turn-cap 记账(启发式):全同一 sender→用其 thread/from;多 sender→用最后一条
   const last = batch[batch.length - 1];
   agent.handling = last.thread; agent.handlingFrom = last.from;
   deliver(batch);
   ```
2. **`deliver` 改批量**:`deliver(msgs: Message[])`(原单条→数组)。orchestrator `makeDeliverer` 同步改。
3. **`formatBatch(msgs)`**:
   - `length === 1` → 等同现有 `formatMessage(单条)`,**行为不变、无额外包装**(单条不加噪声)。
   - `≥ 2` → 头部提示 + 编号列表,每条**带 from 归属**:
     `{inboxBatchHeader(n)}\n[1] 来自 X:…\n[2] 来自 Y:…\n…`
4. **i18n**:`inboxBatchHeader(n)` zh/en(backend 先拟,lead 过目)。
   - zh 草:`你有 {n} 条新消息(已合并),请结合最新情况一并处理、不要只回最早那条:`
   - en 草:`You have {n} new messages (coalesced); handle them together with the latest state in mind, don't just reply to the oldest:`

## 3. 不变量(务必保持)

- guards 仍在 **send 时**生效(合并是投递期 → loop/turn-cap/rate-limit 不受影响)。
- `/clear` hold 期间消息照常入队;resume 后**一次性批量 drain**(顺带改善,不再逐条)。
- `/admin/log` 的 `queued` 语义不变(drain 后即非 queued)。
- `muteStreak`/unresponsive 检测:合并后**一次投递 = 一次预期 MCP 响应**,误判更少;须保持检测仍有效。
- 单条路径**行为零变化**(formatBatch 长度 1 分支 == 旧 formatMessage)。

## 4. 验收要点(qa)

- pump 1 条 → 单条投递、**无 batch 包装**、与现状逐字一致。
- pump 3 条(同 sender)→ **`deliver` 调用 1 次**、payload 含全 3 条、inbox 清空、status=busy、handling/handlingFrom 正确。
- 多 sender 批 → 一次投递含全部、from 归属正确、handling=最后一条。
- busy 期间到达的消息 → 入队不投;idle(onIdle)后**一次性批量** drain。
- **deliver 调用次数 = pump 次数**(不再 = 消息条数)。
- guards:loop/turn-cap/rate-limit 仍 send 时生效,合并不影响(用既有测试 + 补一条"批量投递不触发 loop")。
- i18n:`inboxBatchHeader` zh/en parity。
- 回归:既有 router/bus/orchestrator 测试全绿。

## 5. 任务切分

- **backend(主线)**:router.pump 批量 drain + `deliver(Message[])` + orchestrator `formatBatch` + i18n header。改完 `npm run build` 绿 + `npm test` 不回归。**开工前回我接口签名(deliver/formatBatch)对齐 qa;改完先别提交,确认我"提交"信号(沿用冻结协议:停手→我抓拍提交)。**
- **qa**:§4 测试,依 backend 签名起草。
- **ux**:`inboxBatchHeader` 文案 parity(backend 先拟,ux 可润,非阻塞)。

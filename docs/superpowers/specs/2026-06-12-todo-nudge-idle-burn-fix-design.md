# todolist 巡查空转治理(taskwait 等待声明 + 无果退避)— 设计文档

日期:2026-06-12
类型:功能/成本修复(并入下个版本)
根因报告:外部成本分析(nudge 巡查 × 超长会话上下文全量重放,通宵零产出 $12-22/小时)+ 本机 b7cf 办公室实证。

## 根因

巡查触发信号「全员窗口空闲 ≥ nudgeMinutes」区分不了三种状态:

1. **等外部**:团队在等长脚本/后台测试/CI,pane 空闲但活没停(b7cf 实证:qa 跑 16 轮 e2e 期间被巡查 6 次,期间一直在产出);
2. **做完未关**:任务实际完成但 lead 未调 taskdone(超长上下文指令失焦),巡查永远轰下去(通宵场景);
3. **真停滞**:巡查设计要抓的目标,但信号上与前两种不可分。

引擎(todo.ts tick)对三种一视同仁:固定间隔、发出即重置、永不退避。成本 = 唤起次数 × 单次唤起上下文;每次 nudge 唤醒巨上下文 lead 全量缓存重放,lead 还可能顺手 sendmsg 连锁唤醒队友。

## 方案(三件套)

### 1. `taskwait(seq, minutes, reason)` 等待声明——治「等外部」

- 新 MCP 工具,**lead 专属**(与 taskdone/todoplan 同款权限检查):声明「任务在推进,等外部过程 X 分钟,期间勿巡查」;
- 校验:todolist 必须 running、有 current、seq 必须等于 current.seq、minutes 为 1..120 的整数(封顶 2 小时防睡死)、reason 字符串(可空,空则用默认文案);
- 效果:`waitUntil = now + minutes`、`waitReason` 记入 TodoState(随档持久化,过期自动清除——重启恢复后过期戳无害);等待期内 tick 不巡查且持续推进 idleSince 锚点(到期后按正常节奏重新计时,而非立刻轰);
- taskwait 成功视为进度信号:清零无果计数(见 2);
- **boss 可见性**:调用成功即向消息流发系统公告「【todolist】组长声明等待外部过程:reason,N 分钟内暂停巡查」;控制台 todo 进度行追加「⏳ 等外部:reason(至 HH:MM)」。

### 2. 无果巡查指数退避 + 告警——治「做完未关」兜底

- 引擎记 `fruitlessNudges`(运行时瞬态):每发出一次 nudge +1;taskdone / taskwait / 新任务下发 / start / resume 清零;
- 有效巡查间隔 = `nudgeMinutes × 2^fruitlessNudges`,封顶 `max(60, nudgeMinutes)` 分钟:默认 10→20→40→60→60…,**永不彻底停**(保「没完成不中断」底线);通宵空转 6 次/时 → 1 次/时;
- 第 3 次无果(边沿一次)向消息流告警:「【todolist 告警】任务 #seq 连续 3 次巡查无上报——疑似已完成未关闭或停滞;巡查间隔已退避至 X 分钟。请检查 /todo list,可提醒组长 taskdone 或 /todo stop」。

### 3. 文案升级——降低单次唤起的连锁面

- dispatch 与 nudge 模板都加一句 taskwait 指引:「如在等待长时间脚本/外部过程,调 taskwait(seq, minutes, reason) 声明等待,期间暂停巡查」;
- nudge 模板加:「勿因本提醒向队友发起额外沟通」(堵 lead 被摇醒后顺手 sendmsg 连锁唤醒 600k 队友会话);
- 第 2 次起的 nudge 文案升级:「若该任务实际已完成,说明 #seq 仍未关闭——请**立即**调 taskdone 上报」。

## 实现要点

- `src/core/todo.ts`:TodoState 加 `waitUntil?: number`、`waitReason?: string`(持久化);引擎加 `taskwait(seq, minutes, reason)`、`fruitlessNudges` 私有计数、tick 的等待窗与退避间隔计算;`cb.nudge` 签名扩展(带无果计数,index 拼升级文案);新 cb:`announceWaiting(task, minutes, reason)`、`announceStalled(task, n, intervalMinutes)`;
- `src/bus/server.ts`:注册 `taskwait` 工具(lead 权限检查与 taskdone 同款,touch() 先行);
- `src/index.ts`:TodoEngine 回调接新公告模板;
- `src/console/app.tsx`:todo 进度行追加等待显示;
- `src/i18n/zh.ts` / `en.ts`:新模板(taskwait 公告/停滞告警/进度行等待段/升级 nudge/dispatch 指引),en=typeof zh 平衡;
- 常量:`WAIT_CAP_MIN = 120`、`BACKOFF_CAP_MIN = 60`、`STALL_ANNOUNCE_AT = 3`。

## 测试要点

- 引擎:taskwait 校验全套(非 running/无 current/seq 不符/minutes 越界/非整数);等待期内 tick 不 nudge、到期后按正常节奏恢复(到期 + nudgeMinutes 才第一轰);taskwait 清零退避;
- 退避:无果 1/2/3 次间隔 10/20/40,封顶 60;第 3 次边沿告警一次;taskdone 后恢复 10;anyBusy 重置锚点但**不**清无果计数(忙过≠有上报;只有 taskdone/taskwait 才算进度);
- nudgeMinutes > 60 时封顶 = nudgeMinutes(不缩短 boss 配置);
- 持久化:waitUntil 过期戳重启恢复后无害;
- bus:taskwait 工具 lead 权限、参数校验、公告入流水;
- 实机:start 后 taskwait 静默期无 nudge、控制台进度行显示等待、到期恢复;连续无果观察间隔拉长 + 告警。

## 有意不做

- 不把「团队 MCP 活动」算进度信号(pane busy 已覆盖生成瞬间,增量小,YAGNI);
- 不做熔断停巡(真停滞整晚卡死,违背无人值守初衷);
- 不动单次唤起的上下文大小(CLI 会话所有权在用户,falinks 只能控次数)。

# iTerm 轮询风暴修复(批量化五件套)— 设计文档

日期:2026-06-11
类型:性能/稳定性修复(并入 0.12.0 发布)
根因报告:见下「诊断结论」;实测证据:2 办公室 14 pane 时 23-26 个并发 osascript、iTerm 空闲 CPU 26.4%、单次全遍历 1.1-1.35s。

## 诊断结论

iTerm "未响应"由两个**无界**变量相乘导致雪崩:

1. 单位成本无界增长:`onSession` 每次调用在 iTerm 内全遍历 windows×tabs×sessions,每个属性访问都是发往 iTerm **主线程**的 Apple Event,成本 O(全机 pane 数);
2. 并发无界:健康轮询每 1.5s 每员工 3-4 次调用(paneExists + 无条件 setName + isProcessing + 空闲时 readScreen),单调用 >1s 时一轮跑不完间隔,`setInterval` 无重入护栏照发下一轮 → 轮次无限叠加;osascript spawn 无超时,僵尸不灭;多办公室独立进程相乘。

pane 越多 → 单调用越慢 → 重叠越狠 → iTerm 主线程 Apple Event 队列灌满 → UI 冻结 → 更慢,正反馈。

## 修复五件套

### 1. 批量轮询(核心):每办公室每轮 1 个 osascript

新驱动方法 `pollPanes(targets: { sessionId: string; pinName?: string }[]): Promise<Map<string, { processing: boolean }>>`:

- 一段代码生成的 AppleScript:**单次**遍历全部 sessions,对命中的目标 id 收集 `is processing`,有 `pinName` 的顺带 `set name`(写在同一脚本里,不另起调用);
- 输出格式:每命中一行 `<id>\t<true|false>`,Map 里**缺席 = pane 不存在**(接 missStreak 下线路径);
- 脚本生成与输出解析抽成**纯函数** `buildPollScript(targets)` / `parsePollOutput(out)`(可单测;screen 文本不进批量输出,避免多行内容撑爆解析);
- 接口加进 `TerminalDriver`,`FakeDriver` 用自身状态实现(测试可用)。

### 2. 重入护栏

`pollInFlight` 标志:上一轮未归,本轮直接跳过。轮询从"固定 1.5s 节拍"退化为"至少间隔 1.5s"——pane 极多时表现为状态刷新变慢,而不是堆积冻结。

### 3. readScreen 仅限"待裁决降闲"的员工

现状:`!proc` 就读屏 → **空闲员工每轮都被全屏读**(空闲时 is processing 恒 false),是批量化后的最大残余流量。改为:仅当 `status === 'busy' && !processing`(busy→idle 转换的兜底确认)才读屏;`FALINKS_DEBUG_BUSY=1` 时维持旧行为以便排查。

语义影响评估(可接受):roster 空闲的员工不再被读屏 → 失去"截屏发现空闲员工其实在干活"的兜底。但判忙主信号 `is processing`(最近 ~2s 有输出)本就覆盖一切有输出的活动,截屏判忙识别的 spinner 帧本身就是输出——读屏对空闲员工几乎不提供增量信息(0.8.0 设计时它就只是"廉价兜底")。

### 4. setName 去抖

从每轮无条件写改为**每 10 轮**随批量脚本顺带钉一次(`pollRound % 10 === 0` 时给 targets 带 pinName)。写事件降 90%,标题被 CLI 改掉最多 15s 内恢复。

### 5. osascript 超时

`osascript()` 帮助函数加 15s 超时:到点 `kill` 子进程并 reject。挂死的调用不再永久占位(调用方现有 catch 路径天然兜底:轮询按"探测失败=忙"保守处理)。

## index.ts 轮询重写要点

- 重入护栏包住整轮;`finally` 复位;
- 每轮先 `pollPanes(全部非 restarting 的 sessions)`,Map 缺席走原 missStreak≥3 下线路径,命中清零;
- `clearing` 跳过、A-1 检查、reconcile 调用、A-2 判定、todo.tick **全部保持原语义不动**——改的只是"信号怎么采",不是"信号怎么用";
- `restarting` 员工不进 targets(与原 continue 等价);
- paneBusy = processing || scrapeBusy,scrape 按第 3 条收窄;探测失败(批量调用整体 reject)按"全员维持现状"处理(跳过本轮,护栏自然顺延)。

## 验收标准(对照实测基线)

同等负载(2 办公室、14 pane)复测:并发 osascript 23-26 → **≤2**;iTerm 空闲 CPU 26% → **个位数**;30+ pane 人为压测 iTerm 不失响应。回归:正常员工 busy/idle 流转、A-1/A-2 失联检测、/restart、todolist 巡查全部不变(全量测试 + 实机)。

## 有意不做

- 不迁移 iTerm2 Python API(架构级,要求用户开启;批量化对实际规模已足够,留作未来极端规模的出路);
- 不动 1.5s 间隔本身(护栏已让它自适应);
- 不批量化注入(事件驱动、量小)。

## 实现后记(2026-06-11)

- osascript 超时引出回归路径:ready 检测循环单次读屏 throw 会杀死整个后台准备(实测高负载下 4/4 工人卡死 launching 且无告警)。修正:检测循环逐次容错;A-1 布防提前到准备开始(fresh),交付失败也能 90s 亮 ⚠;后台准备失败落 bootstrap-fail 诊断。
- 验收发现的预存弱点(本期不修,留 backlog):iTerm 重度拥堵时(如旧版办公室风暴仍在),`write text` 注入**启动命令本身**可被截断/丢失(pane 新建 shell 未就绪),员工 pane 沦为死 shell——A-1 ⚠ 可见、/restart 可重试,但拥堵不解除则重试同样脆弱。根治方向:启动命令注入后读屏校验回显、失败重写;或 bootstrapFile 模式扩展到命令本体。旧版办公室全部升级后拥堵源消失,该弱点回到低概率。

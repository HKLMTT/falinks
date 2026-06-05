# 消息可读性 + 选项模式(ask 工具)设计

日期:2026-06-05 · 目标版本:0.2.5

## 背景 / 目标

1. **消息可读性**:控制台「消息」面板现在把每条消息的所有空白压成单空格、截 300 字、一行显示,长内容糊成一坨难读(见用户截图)。要改成分块多行、保留换行、按宽度折行、条间留白。
2. **选项模式**:员工(claude/codex)出"选择题"时,经 falinks 转发只剩纯文本 `sendmsg`,丢了 agent CLI 那种"给用户列选项点选"的能力。要新增显式 `ask` 工具:发给老板时控制台渲染成箭头 picker,老板点选后答案注回提问员工;发给其他 agent 时投递成带编号选项的文本(对方 LLM 读了回选项即可)。

---

## 设计 A — 消息可读性

### A.1 渲染
每条消息渲染成一个块:
- 头部:`from → to`(from 青色,to 品红,与现状一致)。
- 正文:**保留换行**(不再 `replace(/\s+/g,' ')`),每行缩进 2 空格,用 Ink `<Text wrap="wrap">` 按终端宽度自动折行。
- **截断策略(按用户要求:当前回复看全,历史给预览)**:
  - **最新一条**:保留全文(安全上限 40 行,纯防超长把输入框挤出屏幕;正常回复≈全文)。
  - **其余(历史)**:每条只显示前 3 行预览,超出加暗色 `… +N 行(完整见 {from} 窗口)`。
- 条与条之间空一行。
- 面板显示最近 6 条(历史预览 + 最新全文)。

### A.2 纯函数(可单测)
`src/console/log-format.ts`:
```
export interface LogMsg { from: string; to: string; body: string }
export function formatBody(body: string, maxLines: number): { lines: string[]; truncated: number }
```
- 按 `\n` 拆分,去掉首尾空行,逐行 `trimEnd`;
- 超过 `maxLines` 则截到 `maxLines`,`truncated = 原行数 - maxLines`,否则 0;
- 折行交给 Ink(不在此函数做宽度换行)。

console 渲染:对 `log.slice(-6)` 每条 →
- 最新一条用 `formatBody(body, 40)`,其余用 `formatBody(body, 3)`;
- 头部 `<Text>` + 各正文行(缩进 + `wrap="wrap"`)+ `truncated>0` 时的截断提示 + 空行。

### A.3 改动范围
`src/console/app.tsx`(消息渲染段)+ 新文件 `src/console/log-format.ts`。

---

## 设计 B — 选项模式 / ask 工具

### B.1 新 MCP 工具 `ask`
`bus/server.ts` 的 `serverForAgent` 注册:
```
ask(to: string, question: string, options: string[])  // options 至少 1 个
```
- 描述写明:出选择题用本工具;发老板会渲染成可点选项,发同事会收到带编号选项的消息。
- 逻辑:
  - **to 是老板**(`to === 'boss' || to === '老板'`):`questions.add({ from: agentName, question, options })` → 返回 `{ ok:true, id, pending:true }`。员工随后应 `idle` 等待;答案稍后作为一条普通消息注回(见 B.3)。
  - **to 是其他 agent**:`body = question + 编号选项 + "(回复请 sendmsg(to=\"<asker>\", message=\"选 N\"))"`;`router.send(agentName, to, body)`;返回 `{ ok, id }` 或 `{ ok:false, error }`。

### B.2 pending 问题存储
`bus/server.ts` 新增轻量存储(在 `startBus` 作用域创建,传给 `serverForAgent` 与 admin 处理器共享):
```
interface PendingQuestion { id: string; from: string; question: string; options: string[]; ts: number }
class QuestionStore {
  add(q: { from; question; options }): string   // 生成 id(本地计数器)+ ts,存入,返回 id
  list(): PendingQuestion[]
  take(id: string): PendingQuestion | undefined // 取出并删除
}
```
> `serverForAgent(agentName, deps)` 增参 `questions`;`ask` 工具与 admin 路由都用这同一个实例。ts 用 `Date.now()`(运行时代码,允许)。

### B.3 admin 路由
- `GET /admin/questions` → `{ questions: questions.list() }`
- `POST /admin/answer { id, choice }`(`choice` = 选项下标 number):
  - `q = questions.take(id)`;无则 `{ ok:false, error:'no such question' }`。
  - 越界保护:`choice` 不在 `0..options.length-1` 则 `{ ok:false, error:'bad choice' }`。
  - `router.send('boss', q.from, \`对"${q.question}",老板选择:${q.options[choice]}\`)`(复用投递→注回提问员工 pane)。
  - 返回 `{ ok:true }`。

### B.4 控制台 picker
`console/app.tsx`:
- 轮询新增 `/admin/questions`(与 roster/log 同一个 tick),`setQuestions(list)`。
- **交互模式**:当有 pending 问题、且输入框为空、且不在 wizard 时,进入"答题"态,在输入框上方渲染 picker(取 `questions[0]`):
  ```
  ❓ frontend 问你:本期通知模块用哪个方案?
     ▶ 1. 单通道(webhook,简单但难复用)
       2. 多通道(webhook+钉钉+企微+飞书)
       3. 抽象独立 notify 模块(接口化,最稳)
     ↑↓ 选 · Enter 回复 · Esc 跳过   (还有 N 个待答)
  ```
  - `↑↓` 选项移动,`Enter` → `POST /admin/answer {id, choice: 选中下标}`,清空本地选中态(下次 tick 该问题已不在 list)。
  - `Esc` 跳过:本地记下"已跳过的 id",该问题暂不抢输入(老板可正常打字);它仍在 pending,下个新问题照常弹。
  - 一旦老板**开始打字**(任意字符),自动让位给普通输入(该问题视为本次跳过)。
- 与现有 `↑↓` 历史/补全冲突的处理:仅当"答题态"激活(pending && 输入空 && 非 wizard && 未跳过)时,`↑↓/Enter` 归 picker;否则维持现状。

### B.5 HOUSE_RULES 引导
`index.ts` 的 `HOUSE_RULES` 增一句:需要对方在有限选项里做决定时,用 `ask(to, question, options)` 而非纯文本;尤其向老板请示用 ask,老板会直接点选。

### B.6 改动范围
`bus/server.ts`(ask 工具 + QuestionStore + 两条 admin 路由)、`console/app.tsx`(轮询 + picker 模式)、`index.ts`(HOUSE_RULES 一句)。

---

## 设计 C — 防误群发:`@all` + 默认回复上次目标

现状:纯文本 = 群发全员,极易误操作。改为:

### C.1 输入语义(`console/parse.ts`)
- `@all <消息>` → 群发(`broadcast`)。是**唯一**的群发入口。
- `@<名字> <消息>` → 私聊(`say`,名字 ≠ `all`)。
- 纯文本(不以 `@`/`/` 开头) → 新动作 `reply`,发给"上一次对话目标"。
- `/命令` → 不变。
- `ConsoleAction` 去掉"纯文本→broadcast",新增 `{ kind:'reply'; message }`;`broadcast` 改由 `@all` 触发。

### C.2 上一次对话目标(纯函数,可单测)
`console/parse.ts` 新增:
```
export function lastReplyTarget(log: {from:string;to:string}[], self?='boss'): string | null
```
从 log 末尾往前找第一条与 self 相关的消息:`to===self` 取 `from`;`from===self` 取 `to`;都不沾则跳过;找不到返回 null。
- `@名字` 发出后下个轮询(log 出现 boss→名字)即更新目标;员工给 boss 发消息(X→boss)也会把目标切到 X——符合"最近一条对话的对方"。

### C.3 控制台行为(`console/app.tsx`)
- `@` 补全候选加入 `all`(`['all', ...真实成员名]`),`@a` 能补出 `@all`。
- dispatch 处理 `reply`:`const target = lastReplyTarget(log)`;有目标 → `POST /admin/say {to:target}`;无目标 → 提示「没有上次对话目标,请 @某人 或 @all 群发」,不群发。
- 输入提示行改为体现新语义并显示当前目标:`直接打字=回复 @{target||'(无)'} · @all 群发 · @名字 私聊 · / 命令`。
- `/help` 文案同步加 `@all 群发`。

### C.4 输入框 HOME/END 跳转
`useInput` 增加:`Home`(或 `Ctrl+A`)→ `cursor=0`;`End`(或 `Ctrl+E`)→ `cursor=input.length`。Ink 的 `key.home`/`key.end` 不一定可靠,故同时支持 `Ctrl+A`/`Ctrl+E`(终端通用行首/行尾)。

### C.5 改动范围
`console/parse.ts`(语义 + `lastReplyTarget`)、`console/app.tsx`(reply 分派、@all 补全、提示行、HOME/END)、`console/commands.ts`/help 文案。

---

## 测试(vitest,纯函数 + FakeDriver/Router,不碰真 CLI/iTerm)
- `log-format`:`formatBody` 保留换行、去首尾空行、按 maxLines 截断且 truncated 计数正确、空 body。
- `QuestionStore`:add 生成唯一 id、list、take 取出即删、take 不存在返回 undefined。
- bus `ask` 工具:to=boss 进 pending(`/admin/questions` 能查到);to=agent 走 `router.send` 投递带编号选项的消息(FakeDriver 收到注入)。
- admin `/admin/answer`:正常下标 → `router.send('boss', from, …)` 注回且 pending 清空;越界/未知 id → 友好错误。
- `parse`:`@all x`→broadcast;`@bob x`→say;纯文本→reply;`lastReplyTarget` 各情形(boss 发出、收到、无相关、X↔Y 不沾 boss)。

## 实测验收(用户真终端)
1. 起 1 个员工,让它 `ask(to="boss", "选哪个方案", ["A","B","C"])`。
2. 控制台出现 picker;老板选 B;员工 pane 收到「【来自 boss】对"选哪个方案",老板选择:B」。
3. 消息面板里:历史消息多行、保留换行、条间留白、过长的历史显示 3 行预览 +「… +N 行」;**最新一条回复显示全文**。

## 明确不做(YAGNI)
解析 CLI 原生提示;老板自定义文本回答(只点选项);pending 问题持久化(进程内即可);消息面板滚动(靠每条封顶 + 最近 N 条)。

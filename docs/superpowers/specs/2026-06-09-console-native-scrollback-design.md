# 控制台改用原生 scrollback(滚动 + 拖选都原生可用)

日期:2026-06-09

## Context(为什么)

falinks 控制台为防闪烁(0.4.0),把整个界面(花名册 + 消息区 + 输入)**钉死在视口里、overflow 裁剪、原地轮询重绘、从不进 scrollback**。因此它只能**自己捕获鼠标滚轮**实现"回看",而开鼠标上报(`?1000h`)会把终端原生拖选挤掉 → 用户**滚动与拖选复制只能二选一**,体验差。

Claude Code(同为 Ink)把历史消息**提交进终端原生 scrollback**(Ink `<Static>`),只在底部重绘活区,**不开鼠标上报** → 滚轮滚动与拖选复制都交回终端、天生共存。本设计照此重构 falinks 控制台。

目标:**滚轮/触控板滚历史 + 鼠标拖选复制,二者皆原生可用**,不再需要 `/mouse`、Option 拖、自研滚轮回看。

## 架构

**渲染模型:Ink `<Static>` 历史 + 底部活区**

- **消息历史 → `<Static items={committed}>`**:每条消息**只提交一次**进原生 scrollback,完整 markdown(不再截断/折叠)。新消息按 `id` 增量 append(记 `committedIds` 去重)。提交后不再重绘 → 滚轮/拖选归终端,**不开鼠标上报**。
- **底部活区(Ink 动态帧,常驻底部,原地重绘)**,自上而下:
  1. **花名册 statusline**:压成一行——每个成员名(角色色)+ 状态点(`statusGlyph`)+ 组长 `♔`。例:`lead♔ · backend● · qa⠙ · frontend● · ux●`。
  2. **⏳ 等送达行**:实时显示当前仍 `queued`(在对方 inbox 没投出)的消息聚合,如 `⏳ 等送达: → qa · → backend`;无则不显示。送达后对应项自动消失。
  3. **诊断告警行**(已有 diag:guard-drop/inject-fail/auto-idle)。
  4. **状态行**(`status`)。
  5. **输入框**(含目标 chip)。
  6. **交互浮层**(lang/lead 选择器、加员工向导、ask 答题)激活时显示在活区。

**数据流**:轮询 `/admin/roster`(含 lead)、`/admin/log`(含 `queued`)、`/admin/diag` 不变。log 里:
- `queued===false` 的消息 → 进 `<Static>`(按发送顺序,提交一次);
- `queued===true` 的消息 → 汇总进"等送达行"(不提交;送达后下轮变 false → 提交进 Static)。
- 注:同一条消息发送顺序提交,不因排队而乱序——已提交集合按 log 顺序追加 `queued===false` 的新 id。

## 删除(被原生能力取代)

- `keys.ts`:`MOUSE_PUSH/MOUSE_POP`;`app.tsx`/`run.tsx` 的鼠标上报 push/pop;`/mouse` 命令(parse/commands/i18n `mouse*`)。
- 自研回看:`selBack/histBuf/expanded` 状态、`windowByHeight/scrollWindow/visibleCount/browseRowBudget/windowRange`(log-format.ts)、PgUp/PgDn 选中条 + Enter 展开 + 鼠标滚轮事件处理。→ 终端原生滚动翻历史。
- 每条消息尾部会变化的 `⏳排队/✓已送达` 徽标(依赖原地改已渲染行,与 scrollback 冲突)→ 由活区"等送达行"聚合替代。
- 消息截断 + "+N 行 展开"(`formatBody` 的 maxLines 用法、`moreLines/expandMore`)→ scrollback 里完整显示。

## 保留

markdown 渲染(`renderMarkdown`)、命令解析/分发、各选择器/向导/答题、轮询、`displayWidth`(若 statusline 需要)、`nameColor/colorFor/statusGlyph`、目标 chip、diag 告警。

## 关键实现点

- **增量提交**:`<Static>` 的 items 必须是"只增不改"的数组。维护 `committed: Message[]`(已送达、按序),每轮把 log 中 `queued===false` 且 id 未见过的追加进去。`<Static>` 自动只渲染新增项到 scrollback。
- **不闪烁**:Static 内容写一次进 scrollback、永不重绘;活区是小块动态帧。0.4.0 的闪烁源于"整屏 > 视口高度触发 clear",Static 模型不重绘历史,天然规避。**但需真机验证**(尤其活区高度变化、窗口 resize)。
- **不再钉根盒高度/overflow**:移除 `height={rows-1} overflow=hidden` 那套;活区随内容自然占底部。
- **i18n**:新增 `pendingDeliver`(等送达行文案);移除 `mouse*`、`moreLines/expandMore`、回看相关 key。

## 测试

- **纯函数/逻辑单测**:`committed` 增量去重(给一串带 queued 翻转的 log 快照,断言提交集合按序去重、queued 翻 false 才进);"等送达"聚合(从 roster+log 算出待送达目标列表);花名册 statusline 文案。
- **回归**:删掉的 `windowByHeight/scrollWindow/visibleCount` 相关测试一并移除;parse 去掉 `/mouse`;settings 不变。
- **e2e**(CI 跳过,本地):消息提交进输出、底部活区有花名册行;`/mouse` 已无(改测无此命令)。
- 全量 `npm test` + `npx tsc --noEmit` + `npm run build` 绿。
- **真机手测(关键,单测覆盖不到)**:① 滚轮/触控板能滚历史;② 鼠标能拖选复制(不按 Option);③ 不闪烁(空闲/刷消息/resize);④ 发消息给忙的 agent → 底部"等送达"出现 → 对方空闲后消失;⑤ 选择器/向导/答题在活区正常。

## 风险

- **最大风险:闪烁/重绘**。Ink Static + 动态活区是成熟模式(Claude Code 在用),但 falinks 之前刻意避开,需真机确认无回退。
- 放弃自研回看(PgUp 选中/展开)——本会话刚重构的那块代码删除,换原生滚动(用户已认可)。
- 长会话 scrollback 很长:由终端管理,正常。

## 不做(本轮)

- 应用内文字选择/OSC52(不需要——交给终端原生)。
- 保留旧固定面板布局的开关(直接切换到新模型)。

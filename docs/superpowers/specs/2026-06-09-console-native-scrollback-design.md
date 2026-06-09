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

**数据流**:轮询 `/admin/roster`(含 lead)、`/admin/log`(含 `queued`)、`/admin/diag` 不变。

- **提交(scrollback)**:把 log 里**所有**消息**按发送顺序**提交进 `<Static>`,每条只提交一次(无论当前 queued 与否)。被守卫丢弃的消息根本不进 log,所以不会误提交。→ scrollback = 真实发送顺序、不乱序。
- **等送达行(活区)**:**独立地**从当前 `queued===true` 的消息实时聚合显示,不影响提交顺序。某条送达后下轮 `queued` 翻 false → 自动从这行消失(它早已在 scrollback 里、不动)。
- **增量 + 稳定引用(关键)**:committed 用 `useRef` 持有的数组,每轮只 `append` log 中 id 未见过的消息,key=消息 id,**已提交项引用绝不变更**。否则 spinner 每 ~100ms 重渲染整个 App 时 `<Static>` 会重复打印历史。
- **启动喂数上限**:首次把最近约 **100 条**提交进 scrollback(不一次性 dump 持久化的几千条);更早历史不强求(原固定面板也只看近期)。

### `/clear` 与启动 banner

- **`/clear`(全员)**:除清 router/持久化(已有),还要**清终端 scrollback**——发 `\x1b[3J\x1b[2J\x1b[H`(清屏+清回滚缓冲+光标归位)并**重置 committed 数组**;否则已"印"进 scrollback 的旧消息清不掉。
- **`/clear <名字>`(单个)**:**不清**屏(只清那个 pane 上下文,boss 历史/scrollback 保留)。
- **启动 banner**:`FALINKS` ascii + 版本 + tagline 在启动时**打印一次**进 scrollback(像 shell banner,随消息自然滚走),不再常驻顶部。

## 删除(被原生能力取代)

- `keys.ts`:`MOUSE_PUSH/MOUSE_POP`;`app.tsx`/`run.tsx` 的鼠标上报 push/pop;`/mouse` 命令(parse/commands/i18n `mouse*`)。
- 自研回看:`selBack/histBuf/expanded` 状态、`windowByHeight/scrollWindow/visibleCount/browseRowBudget/windowRange`(log-format.ts)、PgUp/PgDn 选中条 + Enter 展开 + 鼠标滚轮事件处理。→ 终端原生滚动翻历史。
- 每条消息尾部会变化的 `⏳排队/✓已送达` 徽标(依赖原地改已渲染行,与 scrollback 冲突)→ 由活区"等送达行"聚合替代。
- 消息截断 + "+N 行 展开"(`formatBody` 的 maxLines 用法、`moreLines/expandMore`)→ scrollback 里完整显示。

## 保留

markdown 渲染(`renderMarkdown`)、命令解析/分发、各选择器/向导/答题、轮询、`displayWidth`(若 statusline 需要)、`nameColor/colorFor/statusGlyph`、目标 chip、diag 告警。

## 关键实现点

- **增量提交**:`<Static>` 的 items 必须是"只增不改"的数组。维护 `committed: Message[]`(**所有已入 log 的消息、按发送顺序**),每轮把 log 中 **id 未见过的**(无论 queued)追加进去。`<Static>` 自动只渲染新增项到 scrollback。(queued 与否只决定"等送达行"是否列它,不影响是否提交。)
- **不闪烁**:Static 内容写一次进 scrollback、永不重绘;活区是小块动态帧。0.4.0 的闪烁源于"整屏 > 视口高度触发 clear",Static 模型不重绘历史,天然规避。**但需真机验证**(尤其活区高度变化、窗口 resize)。
- **不再钉根盒高度/overflow**:移除 `height={rows-1} overflow=hidden` 那套;活区随内容自然占底部。
- **i18n**:新增 `pendingDeliver`(等送达行文案);移除 `mouse*`、`moreLines/expandMore`、回看相关 key。

## 测试

- **纯函数/逻辑单测**:`committed` 增量去重(给一串 log 快照,断言**按发送顺序**追加、id 不重复提交、对象引用稳定);"等送达"聚合(从 log `queued` 算出待送达目标列表,送达后消失);花名册 statusline 文案。
- **回归**:删掉的 `windowByHeight/scrollWindow/visibleCount/windowRange` 相关测试一并移除;parse 去掉 `/mouse`;settings 不变。
- **e2e**(CI 跳过,本地):消息提交进输出、底部活区有花名册行;`/mouse` 已无;`/clear` 全员后清屏。
- 全量 `npm test` + `npx tsc --noEmit` + `npm run build` 绿。
- **真机手测(关键,单测覆盖不到)**:① 滚轮/触控板能滚历史;② 鼠标能拖选复制(不按 Option);③ 不闪烁(空闲/刷消息/resize/spinner 动画时不重复打印历史);④ 发消息给忙的 agent → 底部"等送达"出现 → 对方空闲后消失;⑤ `/clear` 全员后 scrollback 清空、`/clear <名字>` 不清;⑥ 选择器/向导/答题在活区正常、活区变高时不触发整屏 clear。

## 风险

- **闪烁/重绘**:① Ink Static + 动态活区是成熟模式(Claude Code 在用),且新活区**很小**(< 屏高,不触发 0.4.0 那种"超高整屏 clear")——风险其实低于旧全屏模型;② 但 spinner 每 ~100ms 重渲染:committed 必须稳定引用、只 append,否则历史重复打印(已列为关键实现点);③ 浮层(lead 选择器/ask 多选项)会撑高活区,极窄屏需留意。**统一靠真机验证。**
- 放弃自研回看(PgUp 选中/展开)——本会话刚重构的那块代码删除,换原生滚动(用户已认可)。
- resize 后旧 scrollback 行保持旧宽度折行(终端原生行为,不重排)——可接受。
- 发出的消息经轮询回显,scrollback 里出现有 ≤1s 延迟(沿用现状)。
- 长会话 scrollback 很长:由终端管理,正常。

## 不做(本轮)

- 应用内文字选择/OSC52(不需要——交给终端原生)。
- 保留旧固定面板布局的开关(直接切换到新模型)。

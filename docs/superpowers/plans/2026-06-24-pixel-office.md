# 像素办公室（Pixel Office）彩蛋 实现计划

> **For agentic workers:** 本计划由 lead 拆解，分派给 backend / frontend / ux / qa 协作完成。任务用 checkbox 跟踪。

**Goal:** 给 falinks 加一个彩蛋：运行中的 console 输入 `/office` 即在浏览器打开一个像素风办公室网页，实时看到各员工在工位上按状态干活，点员工可看其详情与最近消息流；只读，不能发消息；默认不运行。

**Architecture:** 复用现有 127.0.0.1 单端口 http 总线（`src/bus/server.ts`），新增 `/office`（静态页）、`/office/state`（聚合 roster+log+questions 的单次轮询接口）两类路由。前端为零依赖、零构建的原生 HTML/CSS/JS 单页，1s 轮询 `/office/state`，用 DOM 定位的工位 + 像素角色渲染，状态驱动动画。`/office` 命令在 console 解析后用系统 `open` 打开浏览器。

**Tech Stack:** TypeScript（后端/console）、Node 原生 http、原生 HTML/CSS/JS（前端，无框架）、像素美术程序化绘制（CSS/canvas，无外部素材）、Vitest。

## Global Constraints

- 仅监听 `127.0.0.1`，不对外暴露；不引入任何新的运行时依赖。
- 默认不运行，必须显式 `/office` 触发。
- 网页**只读**：展示 roster/log/questions，不提供发消息/答题/任何写操作入口。
- 前端零构建：不引入打包器；页面资源为静态文件，构建时原样拷贝到 `dist/`。
- 文案走现有 i18n（`src/i18n/zh.ts` / `en.ts`），命令当前 locale 透传给页面。
- 不破坏现有 `vitest` 与 `npm run build`。
- 像素美术统一由 ux 出规范，frontend 按规范实现，避免风格跑偏。

---

## 文件结构

- `src/office/serve.ts`（新建）— 导出 `handleOfficeRequest(req,res,deps): boolean` 与 `buildOfficeState(deps)`；负责静态文件服务（`/office`、`/office/*`）与 `/office/state` 聚合。
- `src/office/web/index.html`（新建）— 页面骨架，引 `office.css`、`office.js`。
- `src/office/web/office.css`（新建）— 像素美术、布局、动画。
- `src/office/web/office.js`（新建）— 轮询、渲染、点选详情、气泡。
- `src/office/web/sprites.js`（新建，可选）— 角色/工位像素帧数据与绘制，由 ux 规范驱动。
- `src/bus/server.ts`（改）— 在请求分发处接入 `handleOfficeRequest`。
- `src/util/open-browser.ts`（新建）— `openBrowser(url)` 跨平台打开浏览器。
- `src/console/parse.ts`（改）— 解析 `/office` → `{ kind: 'office' }`。
- `src/console/commands.ts`（改）— `COMMANDS` 增加 `office` 条目（带 hint）。
- `src/console/app.tsx`（改）— action 分支处理 `office`：调 `openBrowser`，设状态行。
- `src/i18n/zh.ts` / `src/i18n/en.ts`（改）— 命令 hint、状态文案、页面词典 key。
- `package.json`（改）— build 脚本拷贝 `src/office/web` → `dist/office/web`。
- `docs/superpowers/plans/2026-06-24-pixel-office.md`（本文件）。
- 测试：`tests/office/serve.test.ts`、`tests/console/parse-office.test.ts`、`tests/util/open-browser.test.ts`。

### 设计约定（供各任务对齐接口）

`/office/state` 返回 JSON：
```ts
interface OfficeState {
  ts: number;
  roster: Array<{ name: string; role: string; status: 'launching'|'idle'|'busy'|'stuck'|'dead'; virtual: boolean; lead: boolean; unresponsive: boolean }>;
  log: Array<{ id: string; from: string; to: string; body: string; ts: number; thread?: string }>; // 最近 N=200 条，时间升序
  questions: Array<{ id: string; from: string; question: string; options: string[]; ts: number }>;
}
```
- `roster`/`log`/`questions` 字段直接复用 `src/bus/server.ts` 现有 `/admin/*` handler 的取数逻辑（不要新发明取数路径，抽公用即可）。
- 静态文件根目录解析：以编译后模块所在目录为基准定位 `web/`，即 `path.join(__dirname, 'web')`（`dist/office/web` 或 dev 下 `src/office/web`）。

---

## Task 1: openBrowser 工具

**Files:**
- Create: `src/util/open-browser.ts`
- Test: `tests/util/open-browser.test.ts`

**Interfaces:**
- Produces: `export function openBrowser(url: string): void` — 按平台用 `open`(darwin)/`xdg-open`(linux)/`start`(win) 异步打开，失败吞掉不抛。

- [ ] Step1 写失败测试：mock `node:child_process` 的 `spawn`/`exec`，断言 darwin 下以 `open` 调用、传入 url；失败时不抛异常。
- [ ] Step2 跑测试确认失败。
- [ ] Step3 实现 `openBrowser`（用 `spawn(cmd,[url],{stdio:'ignore',detached:true}).unref()`，`try/catch` 吞错）。
- [ ] Step4 跑测试确认通过。
- [ ] Step5 commit：`feat(office): add cross-platform openBrowser util`。

---

## Task 2: /office 路由与 state 聚合（serve.ts + server.ts）

**Files:**
- Create: `src/office/serve.ts`
- Modify: `src/bus/server.ts`（请求分发处）
- Test: `tests/office/serve.test.ts`

**Interfaces:**
- Consumes: 现有 `/admin/roster`、`/admin/log`、`/admin/questions` 的取数逻辑（抽成可复用函数或直接调用 router/状态源）。
- Produces:
  - `export function buildOfficeState(deps): OfficeState`（结构见上）。
  - `export function handleOfficeRequest(req, res, deps): boolean` — 命中 `/office`、`/office/state`、`/office/<asset>` 时处理并返回 `true`，否则 `false`（让原有分发继续）。静态文件含正确 `content-type`，目录穿越防护（拒绝 `..`）。

- [ ] Step1 写失败测试：构造假 deps（含 roster/log/questions 源），调用 `buildOfficeState`，断言字段齐全、log 截断为最近 200 条且时间升序。
- [ ] Step2 跑测试确认失败。
- [ ] Step3 实现 `buildOfficeState` 与 `handleOfficeRequest`（静态服务：`GET /office`→index.html；`GET /office/state`→JSON；`GET /office/<file>`→ `web/` 下文件，路径净化）。
- [ ] Step4 在 `src/bus/server.ts` 分发最前面插入 `if (handleOfficeRequest(req,res,deps)) return;`。
- [ ] Step5 跑测试确认通过；本地 `curl 127.0.0.1:<port>/office/state` 验证 JSON。
- [ ] Step6 commit：`feat(office): serve /office page and /office/state aggregate`。

---

## Task 3: console `/office` 命令接线

**Files:**
- Modify: `src/console/parse.ts`、`src/console/commands.ts`、`src/console/app.tsx`
- Test: `tests/console/parse-office.test.ts`

**Interfaces:**
- Consumes: `openBrowser`（Task1）、运行端口 `port`（app.tsx 已有 prop）。
- Produces: 输入 `/office` → `parseConsoleInput` 返回 `{ kind: 'office' }`；app.tsx 收到后 `openBrowser('http://127.0.0.1:'+port+'/office?lang='+locale)` 并在状态行提示。

- [ ] Step1 写失败测试：`parseConsoleInput('/office')` 返回 `{ kind: 'office' }`。
- [ ] Step2 跑测试确认失败。
- [ ] Step3 parse.ts 增 `office` 分支；commands.ts 增 `{ name:'office', usage:'/office', noArgs:true, hint:t().officeHint }`。
- [ ] Step4 app.tsx action 分支：`if (a.kind==='office'){ openBrowser(...); setStatus(t().officeOpened) }`。
- [ ] Step5 跑测试确认通过。
- [ ] Step6 commit：`feat(office): wire /office console command`。

---

## Task 4: 像素美术规范（ux 输出，前端实现依据）

**Files:**
- Create: `src/office/web/SPRITE-SPEC.md`（规范文档，frontend 依此实现）

**内容要求（无代码，纯规范）：**
- [ ] 调色板（HEX，≤16 色，复古办公室基调：地板/墙/桌/显示器/角色肤色衣服）。
- [ ] 角色规格：像素尺寸（建议 16×24）、4 状态视觉（launching 渐入 / idle 坐姿微呼吸 / busy 打字+屏幕闪 / stuck 头顶? / dead 灰显空椅）、lead 标识（小皇冠/徽标）、boss(virtual) 如何表现（如门口/老板位或不渲染）。
- [ ] 工位规格：桌+显示器像素图、员工在办公室里的网格排布规则。
- [ ] 气泡规格：消息冒泡样式与停留时长建议。
- [ ] 与 falinks 现有视觉（终端风/配色）一致性说明，杜绝跑偏。
- [ ] commit：`docs(office): pixel art sprite spec`。

---

## Task 5: 前端像素办公室页面（frontend，依赖 Task2 接口 + Task4 规范）

**Files:**
- Create: `src/office/web/index.html`、`office.css`、`office.js`、`sprites.js`

**Interfaces:**
- Consumes: `GET /office/state`（Task2 结构）；`?lang=` 参数；i18n 页面词典（内联于 office.js 的小字典，key 对齐 zh/en）。
- Produces: 自包含静态页。

- [ ] Step1 index.html 骨架：办公室容器 + 右侧详情面板 + 引 css/js。
- [ ] Step2 office.css/sprites.js 按 SPRITE-SPEC 实现像素工位与角色、4 状态动画、`image-rendering:pixelated`。
- [ ] Step3 office.js：1s 轮询 `/office/state`，按 roster 增删/更新工位与状态动画；log 出现该员工新消息→头顶气泡。
- [ ] Step4 点员工→右侧面板显示 角色/状态/与其相关最近消息（从 log 过滤 from==name||to==name）。questions 中该员工待答题以"思考气泡/?"提示。
- [ ] Step5 浏览器手测：5 种状态各渲染正确、点选切换、轮询更新、断连(server 关)优雅提示。
- [ ] Step6 commit：`feat(office): pixel office web page`。

---

## Task 6: 构建拷贝静态资源 + i18n 文案

**Files:**
- Modify: `package.json`（build 脚本）、`src/i18n/zh.ts`、`src/i18n/en.ts`

- [ ] Step1 build 脚本：`tsc -p tsconfig.build.json && node -e "...copy src/office/web -> dist/office/web"`（用跨平台 node 拷贝，勿用 `cp -r` 以兼容；或加 `scripts/copy-web.mjs`）。
- [ ] Step2 i18n 增 key：`officeHint`、`officeOpened`、页面词典所需 key（zh/en 同步）。
- [ ] Step3 `npm run build` 验证 `dist/office/web/` 存在且含全部文件。
- [ ] Step4 commit：`build(office): copy web assets; i18n strings`。

---

## Task 7: 端到端验收（qa）

- [ ] `npm run build` 通过、产物含 web 资源。
- [ ] `npm test`（vitest）全绿，无回归。
- [ ] 真机：启动 falinks，console 输入 `/office`→浏览器打开像素办公室；制造 idle/busy/stuck 状态，确认动画切换；点员工看详情；关掉再开正常。
- [ ] 仅监听 127.0.0.1（`lsof`/`netstat` 确认不对外）。
- [ ] 回归：不开 office 时无任何新行为/性能影响。
- [ ] 输出验收报告给 lead。

---

## 自检

- 覆盖：启动方式(Task3)、只读展示(Task2/5)、点选详情(Task5)、像素风(Task4/5)、默认不运行(Task3 触发)、本机限定(Task2/7)、零依赖零构建(全局约束)、i18n(Task6) 均有对应任务。
- 依赖序：Task1/2/4 可并行起步；Task3 依赖 Task1；Task5 依赖 Task2 接口 + Task4 规范；Task6 依赖 Task5 文件就位；Task7 最后。

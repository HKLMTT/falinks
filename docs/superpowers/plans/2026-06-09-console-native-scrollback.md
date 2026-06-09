# 控制台原生 scrollback 重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把控制台消息历史改用 Ink `<Static>` 提交进终端原生 scrollback,底部只留活区,使**滚轮滚动 + 鼠标拖选复制**都交回终端、天生共存(不再开鼠标上报)。

**Architecture:** 消息按 id 增量提交进 `<Static>`(发送顺序、只提交一次、稳定引用);底部活区(动态帧)= 花名册 statusline + 等送达行 + 诊断/状态 + 输入框 + 浮层。删除自研滚轮回看与鼠标上报。

**Tech Stack:** TypeScript, Ink (React for CLI), Vitest。

**前置:** 必须在 0.9.0 已提交后、于干净基线(建议 worktree)上执行——本重构与 0.9.0 改同一批文件。

参考 spec:`docs/superpowers/specs/2026-06-09-console-native-scrollback-design.md`

---

## File Structure

- **新增** `src/console/scrollback.ts`:纯逻辑——`appendCommitted`(增量去重提交)、`pendingTargets`(等送达聚合)。便于单测,App 只调用。
- **改** `src/console/app.tsx`:渲染重写(Static + 活区),删 browse/mouse 状态与事件,clear-all 清屏。
- **改** `src/console/log-format.ts`:删 `windowByHeight/scrollWindow/visibleCount/browseRowBudget/windowRange`;保留 `nameColor/colorFor 用的 NAME_COLORS/statusGlyph/formatTime/displayWidth`。
- **改** `src/console/keys.ts`:删 `MOUSE_PUSH/MOUSE_POP`、`wheel-up/down/mouse` 事件解析。
- **改** `src/console/parse.ts` + `commands.ts`:删 `/mouse`(`mouse-toggle`)。
- **改** `src/console/run.tsx`:删 `MOUSE_POP` 还原。
- **改** `src/i18n/{zh,en}.ts`:加 `pendingDeliver`;删 `mouse*`、`moreLines/expandMore`、`browseHint`、`cmdHint.mouse`。
- **改** 相关测试:删 `log-format-browse`、`log-format-visible`、`log-format-panecolor`(若仅测删掉的)、`keys-mouse`、parse 的 `/mouse`;新增 `scrollback.test.ts`。

---

## Task 1: scrollback 纯逻辑模块 + 测试

**Files:**
- Create: `src/console/scrollback.ts`
- Test: `tests/console/scrollback.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { appendCommitted, pendingTargets } from '../../src/console/scrollback.js';

type M = { id: string; from: string; to: string; body: string; ts: number; queued?: boolean };
const m = (id: string, to = 'qa', queued = false): M => ({ id, from: 'boss', to, body: id, ts: Number(id), queued });

test('appendCommitted:按 log 顺序追加未见过的 id,已提交不动、引用稳定', () => {
  const c0: M[] = [];
  const c1 = appendCommitted(c0, [m('1'), m('2')]);
  expect(c1.map((x) => x.id)).toEqual(['1', '2']);
  const c2 = appendCommitted(c1, [m('1'), m('2'), m('3')]);
  expect(c2.map((x) => x.id)).toEqual(['1', '2', '3']);
  expect(c2[0]).toBe(c1[0]); // 已提交项引用不变(Static 不重打印的前提)
  expect(c2[1]).toBe(c1[1]);
});

test('appendCommitted:无新增时返回同一引用(避免无谓重渲染)', () => {
  const c1 = appendCommitted([], [m('1')]);
  const c2 = appendCommitted(c1, [m('1')]);
  expect(c2).toBe(c1);
});

test('appendCommitted:queued 与否都提交(发送顺序,不乱序)', () => {
  const c = appendCommitted([], [m('1', 'qa', true), m('2', 'backend', false)]);
  expect(c.map((x) => x.id)).toEqual(['1', '2']);
});

test('pendingTargets:仅列 queued 的目标,去重保序;无则空', () => {
  expect(pendingTargets([m('1', 'qa', true), m('2', 'backend', true), m('3', 'qa', true), m('4', 'ux', false)]))
    .toEqual(['qa', 'backend']);
  expect(pendingTargets([m('1', 'qa', false)])).toEqual([]);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx vitest run tests/console/scrollback.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
export interface LogMsg { id: string; from: string; to: string; body: string; ts: number; queued?: boolean }

/** 把 log 中 id 未见过的消息按顺序追加到 committed(已提交项引用不变);无新增则返回原数组。 */
export function appendCommitted<T extends { id: string }>(committed: T[], log: T[]): T[] {
  const seen = new Set(committed.map((m) => m.id));
  const fresh = log.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return committed;
  return [...committed, ...fresh];
}

/** 当前仍在对方 inbox 排队(queued)的目标列表,去重保序。 */
export function pendingTargets(log: LogMsg[]): string[] {
  const out: string[] = [];
  for (const m of log) if (m.queued && !out.includes(m.to)) out.push(m.to);
  return out;
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npx vitest run tests/console/scrollback.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/console/scrollback.ts tests/console/scrollback.test.ts
git commit -m "feat(console): scrollback 提交/等送达 纯逻辑 + 测试"
```

---

## Task 2: i18n 增删

**Files:**
- Modify: `src/i18n/zh.ts`, `src/i18n/en.ts`

- [ ] **Step 1: 加 `pendingDeliver`,删 `mouse*`/`moreLines`/`expandMore`/`browseHint`/`cmdHint.mouse`**

zh.ts:加 `pendingDeliver: (targets: string) => \`⏳ 等送达: ${targets}\`,`(targets 形如 `→ qa · → backend`)。删除 `mouseEnabled`/`mouseDisabled`/`moreLines`/`expandMore`/`browseHint` 及 `cmdHint.mouse`。
en.ts:`pendingDeliver: (targets: string) => \`⏳ pending: ${targets}\`,` 同步删除对应 key。

- [ ] **Step 2: 运行 i18n 测试**

Run: `npx vitest run tests/i18n.test.ts`
Expected: PASS（双语 key 平价;若测试枚举了被删 key 需同步改）

- [ ] **Step 3: 提交**

```bash
git add src/i18n/zh.ts src/i18n/en.ts tests/i18n.test.ts
git commit -m "i18n(console): 加 pendingDeliver,删 mouse/回看/截断相关文案"
```

---

## Task 3: 删 /mouse 命令与鼠标事件解析

**Files:**
- Modify: `src/console/parse.ts`, `src/console/commands.ts`, `src/console/keys.ts`, `src/console/run.tsx`
- Test: `tests/console/parse.test.ts`, `tests/console/commands.test.ts`(改断言), 删 `tests/console/keys-mouse.test.ts`

- [ ] **Step 1: 改测试(先红)** —— parse.test 删 `/mouse` 用例;commands.test 的命令列表断言去掉 `mouse`(`['add','remove','clear','lang','lead','help']`);删 `keys-mouse.test.ts`。

- [ ] **Step 2: 改实现**
  - `parse.ts`:删 `ConsoleAction` 的 `{kind:'mouse-toggle'}`、`if (cmd==='mouse')` 分支。
  - `commands.ts`:删 `{ name:'mouse', ... }`。
  - `keys.ts`:删 `MOUSE_PUSH/MOUSE_POP` 导出、`KeyEvent` 的 `wheel-up/wheel-down/mouse`、SGR 鼠标解码分支(`btn & 64` 那段)。
  - `run.tsx`:`restore()` 去掉 `MOUSE_POP`(只留 `KITTY_POP`)。

- [ ] **Step 3: 运行**

Run: `npx vitest run tests/console/parse.test.ts tests/console/commands.test.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(console): 移除 /mouse 命令与鼠标上报/滚轮事件"
```

---

## Task 4: 删 log-format 回看窗口函数

**Files:**
- Modify: `src/console/log-format.ts`
- Test: 删 `tests/console/log-format-browse.test.ts`、`tests/console/log-format-visible.test.ts`

- [ ] **Step 1: 删实现** —— 从 `log-format.ts` 删 `windowRange`、`windowByHeight`、`scrollWindow`、`visibleCount`、`browseRowBudget`、`PANE_BG_COLORS`/`paneBgColor`/`hexToAppleRGB`?——**注意**:`paneBgColor`/`hexToAppleRGB` 被 pane 染色(index/iterm)使用,**保留**;只删回看相关(windowRange/windowByHeight/scrollWindow/visibleCount/browseRowBudget)。`displayWidth/wrapRows` 若 statusline/无人用则可删,Task 5 确认。

- [ ] **Step 2: 删对应测试文件**

```bash
git rm tests/console/log-format-browse.test.ts tests/console/log-format-visible.test.ts
```

- [ ] **Step 3: 运行 tsc(会暴露 app.tsx 仍在引用——Task 5 修)**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: app.tsx 处报未定义引用（下一步修复）

- [ ] **Step 4: 暂不提交**,与 Task 5 一起(因 app.tsx 依赖)。

---

## Task 5: app.tsx 渲染重写(核心)

**Files:**
- Modify: `src/console/app.tsx`

> 本任务无法单测(Ink 渲染),靠 tsc + 真机验证。按下述结构改写。

- [ ] **Step 1: 删状态与事件** —— 删 `selBack/histBuf/expanded/mouseOn` 状态、`winStartRef`;删 useInput 里 `pageup/pagedown/wheel-up/wheel-down/mouse`、Enter 展开、browse 相关;删 `mouse-toggle` dispatch、`MOUSE_PUSH/POP` 的 useEffect;删 `rows`-based 窗口计算(VIS/win/shownMsgs/baseIdx/browseMsgHeight)。

- [ ] **Step 2: 提交累积 + 等送达** —— 用 ref 持有 committed:

```tsx
import { Static } from 'ink';
import { appendCommitted, pendingTargets } from './scrollback.js';
// ...
const committedRef = useRef<any[]>([]);
const [committed, setCommitted] = useState<any[]>([]);
// 轮询 tick 里(替换原 setLog 逻辑):拉全量近 100 条
const l = await admin(port, 'GET', '/admin/log?limit=100');
const log = l.log ?? [];
const next = appendCommitted(committedRef.current, log);
if (next !== committedRef.current) { committedRef.current = next; setCommitted(next); }
const pend = pendingTargets(log);
// setPending(pend) — 新 state
```

- [ ] **Step 3: 渲染** —— 顶层不再钉高度/overflow:

```tsx
return (
  <Box flexDirection="column">
    <Static items={committed}>
      {(m: any) => (
        <Box key={m.id} flexDirection="column" marginBottom={1}>
          <Text>
            <Text dimColor>{formatTime(m.ts)} </Text>
            <Text color={colorFor(m.from)} bold>{m.from}</Text>
            <Text> → </Text>
            <Text color={colorFor(m.to)} bold>{m.to}</Text>
          </Text>
          {renderMarkdown(String(m.body)).map((segs: any[], j: number) => (
            <Text key={j} wrap="wrap">{'  '}{segs.map((s, k) => (
              <Text key={k} bold={s.bold} italic={s.italic} underline={s.underline} strikethrough={s.strikethrough} dimColor={s.dim}>{s.text}</Text>
            ))}</Text>
          ))}
        </Box>
      )}
    </Static>
    {/* 活区:花名册 statusline + 等送达 + 诊断 + 状态 + 输入 + 浮层 */}
    <Box flexDirection="column" flexShrink={0}>
      <Text>{roster.map((a, i) => (
        <Text key={a.name}>{i ? ' · ' : ''}<Text color={color(a.status)}>{statusGlyph(a.status, !!a.virtual, frame)}</Text><Text color={colorFor(a.name)} bold>{a.name}</Text>{a.lead ? <Text color="cyan">♔</Text> : null}</Text>
      ))}</Text>
      {pending.length ? <Text color="yellow">{t().pendingDeliver(pending.map((n) => '→ ' + n).join(' · '))}</Text> : null}
      {/* diag 告警行(沿用现有计算) */}
      {/* 选择器/向导/答题浮层(沿用现有 JSX) */}
      {/* 输入框 + 目标 chip(沿用现有) */}
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  </Box>
);
```

- [ ] **Step 4: 启动 banner** —— logo 作为 `<Static>` 的首项一次性提交(把 banner 拼成一条特殊 item,或在 Static 之前用 `useEffect(()=>{ stdout.write(bannerText) },[])` 打印一次)。推荐 useEffect 打印,避免混进消息项。

- [ ] **Step 5: clear-all 清屏** —— dispatch 的 `clear` 分支,`!a.name` 成功后:

```tsx
if (a.kind === 'clear') {
  const r = await admin(port, 'POST', '/admin/clear', { name: a.name });
  if (r.ok && !a.name) { process.stdout.write('\x1b[3J\x1b[2J\x1b[H'); committedRef.current = []; setCommitted([]); }
  setStatus(/* ... 沿用 */);
}
```

- [ ] **Step 6: tsc 通过**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 7: 提交(含 Task 4 的删除)**

```bash
git add -A
git commit -m "feat(console): 渲染改用 Ink Static 原生 scrollback + 底部活区(花名册 statusline/等送达)"
```

---

## Task 6: 全量验证 + 真机

- [ ] **Step 1:** `npx vitest run` 全绿;`npx tsc --noEmit` 干净;`npm run build` 通过。
- [ ] **Step 2: 真机手测**(`node dist/cli.js up <config>`),逐项确认 spec「测试-真机手测」①~⑥:滚轮滚历史、鼠标拖选复制(不按 Option)、不闪烁(空闲/刷消息/resize/spinner)、等送达出现与消失、`/clear` 全员清屏与单个不清、浮层正常。
- [ ] **Step 3:** 若闪烁/重复打印 → 检查 committed 引用稳定性(Task 1 不变性)与活区高度;修复后重测。
- [ ] **Step 4: 发布** —— 按版本规则,这是功能改动 → minor 升一位;改 package.json + CHANGELOG,`chore(release)` + tag + push(CI 发 npm)。

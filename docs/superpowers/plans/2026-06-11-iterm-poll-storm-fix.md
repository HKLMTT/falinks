# iTerm 轮询风暴修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 健康轮询从"每员工 3-4 次全遍历 AppleScript/1.5s、无护栏无超时"改为"每办公室每轮 1 个批量脚本 + 重入护栏 + 读屏收窄 + 标题去抖 + 超时",消除 iTerm 未响应雪崩。

**Architecture:** 驱动层加 `pollPanes` 批量方法(脚本生成/解析为纯函数可单测);index.ts 轮询体重写为护栏+批量采集,**信号的使用语义(missStreak/A-1/A-2/reconcile/todo.tick)一律不动**,只改采集方式。

**Tech Stack:** TypeScript ESM,vitest。门槛:全项目 `npx tsc --noEmit` + `npm test`;交付前 `npm run build`。

**Spec:** `docs/superpowers/specs/2026-06-11-iterm-poll-storm-fix-design.md`

---

### Task 1: 驱动层——osascript 超时 + pollPanes 批量(纯函数 + 双驱动实现)

**Files:**
- Modify: `src/terminal/iterm.ts`
- Modify: `src/terminal/driver.ts`(接口 + FakeDriver)
- Test: `tests/terminal/poll-panes.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

```ts
// tests/terminal/poll-panes.test.ts
import { expect, test } from 'vitest';
import { buildPollScript, parsePollOutput } from '../../src/terminal/iterm.js';
import { FakeDriver } from '../../src/terminal/driver.js';

test('buildPollScript:单次遍历,按 id 分支,带 pinName 的顺带 set name', () => {
  const s = buildPollScript([
    { sessionId: 'AAA-1', pinName: 'lead' },
    { sessionId: 'BBB-2' },
  ]);
  expect(s).toContain('tell application "iTerm2"');
  // 只有一组 repeat 遍历(单次扫描)
  expect(s.match(/repeat with w in windows/g)!.length).toBe(1);
  expect(s).toContain('if sid is "AAA-1"');
  expect(s).toContain('if sid is "BBB-2"');
  expect(s).toContain('set name of s to "lead"');
  // 没给 pinName 的不写名
  expect(s.match(/set name of s/g)!.length).toBe(1);
  expect(s).toContain('is processing of s');
});

test('buildPollScript:pinName 经 AppleScript 转义', () => {
  const s = buildPollScript([{ sessionId: 'A', pinName: 'x"y\\z' }]);
  expect(s).not.toContain('set name of s to "x"y'); // 原文不应裸出现
});

test('parsePollOutput:解析 id\\tprocessing 行,缺席=不存在', () => {
  const m = parsePollOutput('AAA-1\ttrue\nBBB-2\tfalse\n');
  expect(m.get('AAA-1')).toEqual({ processing: true });
  expect(m.get('BBB-2')).toEqual({ processing: false });
  expect(m.has('CCC-3')).toBe(false);
  expect(parsePollOutput('').size).toBe(0);
  expect(parsePollOutput('garbage-line\n\n').size).toBe(0); // 容错:不合格式的行忽略
});

test('FakeDriver.pollPanes:存在的返回 processing,缺席=已关,pinName 落到 names', async () => {
  const d = new FakeDriver();
  const a = await d.launch({ cwd: '/x', command: 'cat' });
  const b = await d.launch({ cwd: '/x', command: 'cat' });
  d.setProcessing(a, true);
  await d.closePane(b);
  const m = await d.pollPanes([{ sessionId: a, pinName: 'alice' }, { sessionId: b }]);
  expect(m.get(a)).toEqual({ processing: true });
  expect(m.has(b)).toBe(false);
  expect(d.names.get(a)).toBe('alice');
});

test('pollPanes 空目标不应触达底层(纯空 Map)', async () => {
  const d = new FakeDriver();
  expect((await d.pollPanes([])).size).toBe(0);
});
```

- [ ] **Step 2: 确认失败**:`npx vitest run tests/terminal/poll-panes.test.ts` → FAIL(导出不存在)。

- [ ] **Step 3: 实现**

① `src/terminal/driver.ts`:

接口加(`isProcessing` 之后):

```ts
  /** 批量轮询:单次遍历采集每个目标 pane 的存在性与 is processing;带 pinName 的顺带钉标题。
   *  返回 Map,**缺席的 id = pane 已不存在**。一办公室一轮一次调用,替代逐 pane 的 paneExists/isProcessing/setName 风暴。 */
  pollPanes(targets: { sessionId: string; pinName?: string }[]): Promise<Map<string, { processing: boolean }>>;
```

`FakeDriver` 加实现:

```ts
  async pollPanes(targets: { sessionId: string; pinName?: string }[]): Promise<Map<string, { processing: boolean }>> {
    const m = new Map<string, { processing: boolean }>();
    for (const t of targets) {
      if (!this.windows.has(t.sessionId)) continue;
      if (t.pinName !== undefined) this.names.set(t.sessionId, t.pinName);
      m.set(t.sessionId, { processing: this.processing.get(t.sessionId) ?? false });
    }
    return m;
  }
```

② `src/terminal/iterm.ts`:

`osascript()` 加 15s 超时(整函数替换):

```ts
/** 执行一段 AppleScript(经 osascript stdin),返回 trim 后的 stdout。
 *  15s 超时强杀:iTerm 主线程拥堵时挂死的调用不再永久占位(调用方按"探测失败"兜底)。 */
const OSASCRIPT_TIMEOUT_MS = 15_000;
function osascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('osascript', ['-']);
    let out = '';
    let err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('osascript timeout')); }, OSASCRIPT_TIMEOUT_MS);
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `osascript exit ${code}`));
    });
    p.stdin.write(script);
    p.stdin.end();
  });
}
```

文件末尾(class 外)加纯函数 + class 内加方法:

```ts
/** 生成批量轮询脚本:单次遍历全部 sessions,对命中的目标收集 is processing(一行 `id<TAB>bool`),
 *  带 pinName 的顺带 set name(写进同一脚本,不另起调用)。导出供单测。 */
export function buildPollScript(targets: { sessionId: string; pinName?: string }[]): string {
  const branches = targets
    .map((t) => {
      const pin = t.pinName !== undefined ? `\n          set name of s to "${escapeAppleScript(t.pinName)}"` : '';
      return `        if sid is "${t.sessionId}" then${pin}
          set out to out & sid & tab & ((is processing of s) as string) & linefeed
        end if`;
    })
    .join('\n');
  return `tell application "iTerm2"
  set out to ""
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        set sid to (id of s)
${branches}
      end repeat
    end repeat
  end repeat
  return out
end tell`;
}

/** 解析批量轮询输出:每行 `id<TAB>true|false`;不合格式的行忽略(容错)。 */
export function parsePollOutput(out: string): Map<string, { processing: boolean }> {
  const m = new Map<string, { processing: boolean }>();
  for (const line of out.split('\n')) {
    const i = line.indexOf('\t');
    if (i <= 0) continue;
    const flag = line.slice(i + 1).trim();
    if (flag !== 'true' && flag !== 'false') continue;
    m.set(line.slice(0, i), { processing: flag === 'true' });
  }
  return m;
}
```

`ITerm2Driver` 类内(`isProcessing` 之后):

```ts
  async pollPanes(targets: { sessionId: string; pinName?: string }[]): Promise<Map<string, { processing: boolean }>> {
    if (targets.length === 0) return new Map();
    return parsePollOutput(await osascript(buildPollScript(targets)));
  }
```

- [ ] **Step 4: 确认通过**:`npx vitest run tests/terminal/` 全绿;`npx tsc --noEmit` 0 错。

- [ ] **Step 5: Commit**

```bash
git add src/terminal/iterm.ts src/terminal/driver.ts tests/terminal/poll-panes.test.ts
git commit -m "feat(terminal): pollPanes 批量轮询(单遍历采集+顺带钉名)+ osascript 15s 超时"
```

---

### Task 2: index.ts 轮询体重写(护栏 + 批量 + 读屏收窄 + 钉名去抖)

**Files:**
- Modify: `src/index.ts`(健康轮询 setInterval 块,~line 419-510;先完整读现状)

无新单测(轮询体依赖 iTerm;信号使用语义不变,由既有 424 测试 + Task 3 实测回归兜底)。门槛:每步 `npx tsc --noEmit`。

- [ ] **Step 1: 重写 setInterval 块**

把现有 `setInterval(() => { void (async () => { for (const [name, sid] of [...sessions]) { ... } /* todo.tick */ })(); }, 1500)` 整块替换为(**保留所有现有判定逻辑原文**——missStreak/forgetAgentState/clearing/A-1/reconcile/A-2/diag/todo.tick 的代码一行不改,只换信号采集外壳):

```ts
  // 健康轮询(≥1.5s):批量采集 + 重入护栏。改造动机见 docs/superpowers/specs/2026-06-11-iterm-poll-storm-fix-design.md:
  // 旧实现每员工每轮 3-4 次全遍历 AppleScript,多办公室叠加把 iTerm 主线程灌死(实测 23+ 并发 osascript)。
  // 现在:每轮一个批量脚本(存在性+is processing+顺带钉名),读屏只给"busy 且不在生成"的员工做降闲裁决。
  const NAME_PIN_EVERY = 10; // 每 10 轮随批量脚本钉一次标题(≈15s),代替逐轮无条件写
  let pollInFlight = false;  // 重入护栏:上一轮未归本轮跳过——pane 极多时轮询自动变慢,而不是叠加冻死 iTerm
  let pollRound = 0;
  setInterval(() => {
    if (pollInFlight) return;
    pollInFlight = true;
    void (async () => {
      try {
        pollRound++;
        const pin = pollRound % NAME_PIN_EVERY === 0;
        const targets = [...sessions].filter(([nm]) => !restarting.has(nm)); // 重启中:旧 pane 已关属预期,跳过
        let statuses: Map<string, { processing: boolean }>;
        try {
          statuses = await driver.pollPanes(targets.map(([nm, sid]) => ({ sessionId: sid, pinName: pin ? nm : undefined })));
        } catch {
          return; // 批量探测整体失败(超时/iTerm 忙):本轮全员维持现状,护栏顺延下一轮再试
        }
        for (const [name, sid] of targets) {
          try {
            const st = statuses.get(sid);
            if (!st) {
              const n = (missStreak.get(name) ?? 0) + 1;
              missStreak.set(name, n);
              if (n < 3) continue; // 连续 3 次缺席才下线(瞬时误报去抖)
              sessions.delete(name);
              if (sid === lastRight) lastRight = consoleSid;
              router.removeAgent(name);
              forgetAgentState(name);
              missStreak.delete(name);
              if (!inProcessConsole) console.log(t().workerWindowClosed(name));
              continue;
            }
            missStreak.delete(name);

            if (clearing.has(name)) continue;

            // —— 以下与旧实现逐行同语义:A-1 报到超时 → 状态校准(reconcile)→ A-2 有活无声 ——
            const exp = expectRegister.get(name);
            if (exp) {
              const verdict = checkRegisterTimeout({ now: Date.now(), by: exp.by, since: exp.since, lastMcpAt: router.get(name)?.lastMcpAt });
              if (verdict === 'satisfied') expectRegister.delete(name);
              else if (verdict === 'timeout') { expectRegister.delete(name); alarmUnresponsive(name, 'register-timeout'); }
            }

            const a = router.get(name);
            if (a && (a.status === 'busy' || a.status === 'idle')) {
              const proc = st.processing;
              let scrapeBusy = false;
              let bottom = '';
              // 读屏收窄:只给"busy 且不在生成"的员工做降闲裁决(空闲员工逐轮全屏读是批量化后最大残余流量;
              // 判忙主信号 is processing 已覆盖一切有输出的活动,读屏对空闲员工几乎无增量)。DEBUG 时维持旧行为。
              if ((!proc && a.status === 'busy') || DEBUG_BUSY) {
                try {
                  const screen = await driver.readScreen(sid);
                  scrapeBusy = isPaneBusy(screen);
                  if (DEBUG_BUSY) bottom = screen.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean).slice(-2).join(' ⏎ ');
                } catch {
                  scrapeBusy = true; // 探测失败按"忙"处理,别误降 idle
                }
              }
              const paneBusy = proc || scrapeBusy;
              const grace = Date.now() - (lastDeliverAt.get(name) ?? 0) > IDLE_GRACE_MS;
              const streak = paneBusy ? 0 : (idleStreak.get(name) ?? 0) + 1;
              idleStreak.set(name, streak);
              const action = reconcilePaneStatus({
                status: a.status,
                paneBusy,
                gracePassed: grace,
                idleStreak: streak,
                idleThreshold: IDLE_STREAK,
              });
              if (DEBUG_BUSY) {
                try { appendDiag(launchCwd, { kind: 'poll', name, status: a.status, proc, scrape: scrapeBusy, paneBusy, grace, streak, action, bottom, ts: Date.now() }); } catch { /* ignore */ }
              }
              if (action === 'mark-idle') {
                const since = Date.now() - (lastDeliverAt.get(name) ?? 0);
                if (since < SUSPECT_FAST_IDLE_MS) {
                  try { appendDiag(launchCwd, { kind: 'auto-idle', name, sinceDeliverMs: since, ts: Date.now() }); } catch { /* 诊断落盘失败不致命 */ }
                }
                const mv = judgeAutoIdleSilence({ deliveredAt: lastDeliverAt.get(name), countedAt: muteCountedAt.get(name) ?? 0, lastMcpAt: a.lastMcpAt });
                muteCountedAt.set(name, mv.countedAt);
                if (mv.reset) router.clearMute(name);
                if (mv.count && router.bumpMute(name) >= MUTE_THRESHOLD) alarmUnresponsive(name, 'mute');
                router.onIdle(name);
              } else if (action === 'mark-busy') router.observeBusy(name);
            }
          } catch {
            /* 单员工处理失败忽略,下一轮再试 */
          }
        }

        // todolist 巡查驱动:全员(非虚拟)无人 busy 视为空闲;lead 存活与否决定挂起/恢复。
        const rs = router.roster();
        todo.tick(rs.some((x) => !x.virtual && x.status === 'busy'), rs.some((x) => x.lead && x.status !== 'dead'));
      } finally {
        pollInFlight = false;
      }
    })();
  }, 1500);
```

实施注意:
- 替换前**通读现有块**,逐项核对上面代码确实涵盖了现有全部行为(A-1/A-2/diag 字段名/`forgetAgentState`/`workerWindowClosed`/锚点复位),漏一项都算错;现有块里 `await driver.setName(sid, name)` 一行**删除**(由批量 pinName 取代);
- `restarting` 过滤从循环内 `continue` 移到了 targets 构造处——语义等价(重启中员工本轮完全不碰);
- 旧实现 `idleStreak` 在员工下线时由 `forgetAgentState` 清(已有),无需另动;
- DEBUG_BUSY 分支读屏行为与旧版一致(逐员工逐轮)。

- [ ] **Step 2: 门槛**:`npx tsc --noEmit && npm test` 全绿(424+5 测试)。

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "perf(core): 健康轮询批量化——一轮一脚本+重入护栏+读屏收窄+钉名去抖,消除 iTerm Apple Event 风暴"
```

---

### Task 3: 全量验证 + 构建 + 实测对照基线

- [ ] **Step 1**: `npx tsc --noEmit && npm test && npm run build` 全绿。
- [ ] **Step 2**: 实测(控制器执行,不派子代理):起一个 5 员工测试办公室,对照基线复测——并发 osascript(基线 23-26 → 预期 ≤2)、iTerm CPU(26% → 个位数);回归验证员工 busy/idle 流转、注册报到、标题钉名(等 10 轮后)正常。
- [ ] **Step 3**: 发现问题回 Task 1/2 修;通过后并入 0.12.0 发布(重做 release 提交)。

---

## Self-Review 结果

- **Spec 覆盖**:五件套——批量(T1 pollPanes+T2 接线)、护栏(T2 pollInFlight)、读屏收窄(T2 条件+DEBUG 保留)、钉名去抖(T2 NAME_PIN_EVERY=10 经批量 pinName)、超时(T1 osascript 15s)。验收基线对照(T3)。「信号使用语义不动」:A-1/A-2/reconcile/missStreak/todo.tick 代码原样保留在 T2 重写块中。
- **占位扫描**:无;T2 给了完整替换代码。
- **类型一致**:`pollPanes(targets: {sessionId, pinName?}[]) → Map<string,{processing}>` 贯穿接口/两驱动/调用点;`buildPollScript/parsePollOutput` 导出名与测试一致。

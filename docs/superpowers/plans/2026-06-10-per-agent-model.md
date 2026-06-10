# 员工指定模型 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个员工可在配置/向导里指定模型,贯穿首启/resume//clear//restart;顺手修复 /add 员工不进内存 cfg.agents 的既有缺口。

**Architecture:** `AgentConfig.model?` 一路透传:config 解析 → /add 向导 → /admin/add → onAddAgent → launchInto → buildAgentLaunch(claude `--model`、codex `-m`,fresh 与 resume 都加)。Spike 已验证:`codex --help` 与 `codex resume --help` 均有 `-m, --model <MODEL>`。

**Tech Stack:** TypeScript ESM(NodeNext,`.js` 后缀导入)、vitest、Ink。测试 `npm test`,构建 `npm run build`(交付前必须 build,用户跑 dist/)。

**Spec:** `docs/superpowers/specs/2026-06-10-per-agent-model-and-todolist-design.md`(功能 1 部分)

---

### Task 1: config 解析 + 类型

**Files:**
- Modify: `src/core/config.ts`
- Test: `tests/core/config-model.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

```ts
// tests/core/config-model.test.ts
import { expect, test } from 'vitest';
import { parseConfig } from '../../src/core/config.js';

const base = (extra: object = {}) => ({
  agents: [{ name: 'a', cli: 'claude', cwd: '/x', bootstrap: 'b', ...extra }],
  routes: {},
});

test('model 可选:缺省为 undefined', () => {
  const cfg = parseConfig(base());
  expect(cfg.agents[0].model).toBeUndefined();
});

test('model 字符串透传', () => {
  const cfg = parseConfig(base({ model: 'claude-opus-4-8' }));
  expect(cfg.agents[0].model).toBe('claude-opus-4-8');
});

test('model 非字符串报错', () => {
  expect(() => parseConfig(base({ model: 42 }))).toThrow(/model/);
});

test('model 空字符串视为未设置(归一化为 undefined)', () => {
  const cfg = parseConfig(base({ model: '' }));
  expect(cfg.agents[0].model).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/config-model.test.ts` — Expected: FAIL(model 字段不存在/非字符串不抛)。

- [ ] **Step 3: 实现**

`src/core/config.ts`:`AgentConfig` 接口 `lead?` 行后加:

```ts
  model?: string; // 模型名,透传给 CLI(claude --model / codex -m);缺省=CLI 全局默认
```

`parseConfig` 的 agents map 里,在 name 去重校验后加:

```ts
    if (a.model !== undefined && typeof a.model !== 'string')
      throw new Error(`config.agents[${i}].model must be a string`);
```

返回对象改为:

```ts
    return { name: a.name, cli: a.cli, cwd: a.cwd, role: a.role, lead: a.lead === true, bootstrap: a.bootstrap, model: a.model || undefined };
```

(`|| undefined` 把空串归一化掉。)

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/` — Expected: 全绿无回归。

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/core/config-model.test.ts
git commit -m "feat(config): AgentConfig 可选 model 字段"
```

---

### Task 2: buildAgentLaunch 命令带模型参数

**Files:**
- Modify: `src/agent/mcp-config.ts`
- Test: `tests/agent/` 下新建 `mcp-config-model.test.ts`(harness 先看同目录现有测试文件的写法并沿用)

- [ ] **Step 1: 写失败测试**

```ts
// tests/agent/mcp-config-model.test.ts
import { expect, test } from 'vitest';
import { buildAgentLaunch } from '../../src/agent/mcp-config.js';

const spec = (extra: object = {}) => ({
  name: 'dev', busPort: 1234, mcpConfigPath: '/tmp/m.json',
  bootstrap: 'hi', bootstrapFile: '/tmp/b.txt', ...extra,
});

test('claude fresh:有 model 加 --model,无则不加', () => {
  expect(buildAgentLaunch('claude', spec({ model: 'claude-opus-4-8' })).command).toContain('--model claude-opus-4-8');
  expect(buildAgentLaunch('claude', spec()).command).not.toContain('--model');
});

test('claude resume 也带 --model(防恢复后漂回全局默认)', () => {
  const c = buildAgentLaunch('claude', spec({ model: 'claude-opus-4-8', resumeId: 'sid-1' })).command;
  expect(c).toContain('--resume sid-1');
  expect(c).toContain('--model claude-opus-4-8');
});

test('codex fresh 与 resume 都带 -m', () => {
  expect(buildAgentLaunch('codex', spec({ model: 'o3' })).command).toContain('-m o3');
  const r = buildAgentLaunch('codex', spec({ model: 'o3', resumeId: 'sid-2' })).command;
  expect(r).toContain('resume sid-2');
  expect(r).toContain('-m o3');
});

test('模型名经 shell 安全处理(含空格等不破坏命令)', () => {
  const c = buildAgentLaunch('claude', spec({ model: 'weird name' })).command;
  expect(c).toContain("--model 'weird name'");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/agent/mcp-config-model.test.ts` — Expected: FAIL。

- [ ] **Step 3: 实现**

`src/agent/mcp-config.ts`:

`LaunchSpec` 加字段(`badge?` 行后):

```ts
  model?: string;        // 模型名:claude 加 --model、codex 加 -m;fresh 与 resume 都带(防恢复后漂回全局默认)
```

`buildAgentLaunch` 两个分支:

claude(注意 model 含特殊字符时走 `shQuote`,简单字母数字横线点直接拼也可——统一用 `shQuote` 最稳,但纯净模型名加引号无害):

```ts
    case 'claude': {
      const tail = spec.resumeId
        ? ` --resume ${spec.resumeId}`
        : spec.sessionId
          ? ` --session-id ${spec.sessionId}`
          : '';
      const model = spec.model ? ` --model ${shQuote(spec.model)}` : '';
      return {
        command: withBadge(`claude --mcp-config ${spec.mcpConfigPath} --dangerously-skip-permissions${model}${tail}`, spec.badge),
        needsBootstrapInject: true,
      };
    }
```

注意:`shQuote` 对简单串可能返回不带引号或带引号——看 `src/terminal/iterm.ts` 的 `shQuote` 实现后对齐测试 4 的断言(若 shQuote 对含空格串输出 `'weird name'` 则断言成立;若实现不同,调整断言为 `toMatch`)。

codex(`base` 串里、`--dangerously-bypass-approvals-and-sandbox` 之后加模型段;resume 与 fresh 共用 base,天然两者都带):

```ts
      const model = spec.model ? ` -m ${shQuote(spec.model)}` : '';
      const base =
        `codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox${model}` +
        ` -c 'mcp_servers.falinks.transport="streamable_http"'` +
        ` -c 'mcp_servers.falinks.url="${url}"'`;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/agent/` — Expected: 全绿(含既有测试,确认无 model 时命令不变)。

- [ ] **Step 5: Commit**

```bash
git add src/agent/mcp-config.ts tests/agent/mcp-config-model.test.ts
git commit -m "feat(agent): 启动命令带模型参数——claude --model / codex -m,fresh+resume 全覆盖"
```

---

### Task 3: 透传链(admin/add → onAddAgent → launchInto)+ cfg.agents 缺口修复 + 持久化口

**Files:**
- Modify: `src/bus/server.ts`(BusDeps.onAddAgent 签名、/admin/add body)
- Modify: `src/index.ts`(launchInto 参数、onAddAgent push cfg.agents)
- Modify: `src/team-persist.ts`(model 写回)
- Modify: `src/templates.ts`(模板 agent 可带 model——只需类型允许,模板本身不必设值)
- Test: `tests/bus/admin-add-model.test.ts`(新建)、`tests/team-persist.test.ts`(追加)

- [ ] **Step 1: 写失败测试**

`tests/bus/admin-add-model.test.ts`(harness 仿 tests/bus/admin-restart.test.ts):

```ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let specs: any[];

beforeEach(async () => {
  const driver = new FakeDriver();
  let n = 0;
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  specs = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    onAddAgent: async (spec) => { specs.push(spec); return { ok: true }; },
  }, 0);
});

afterEach(async () => { await bus.close(); });

test('/admin/add 透传 model 给 onAddAgent', async () => {
  await fetch(`http://127.0.0.1:${bus.port}/admin/add`, {
    method: 'POST',
    body: JSON.stringify({ name: 'dev', cli: 'claude', cwd: '/x', role: 'r', model: 'claude-opus-4-8' }),
  });
  expect(specs[0].model).toBe('claude-opus-4-8');
});

test('model 缺省为 undefined', async () => {
  await fetch(`http://127.0.0.1:${bus.port}/admin/add`, {
    method: 'POST',
    body: JSON.stringify({ name: 'dev', cli: 'claude', cwd: '/x' }),
  });
  expect(specs[0].model).toBeUndefined();
});
```

`tests/team-persist.test.ts` 追加(沿用该文件现有的临时配置文件 harness):

```ts
test('addAgentToConfigFile 写回 model 字段', () => {
  // 沿用本文件已有的写临时 config + 调 addAgentToConfigFile 的模式:
  // addAgentToConfigFile(path, { name: 'm1', cli: 'claude', cwd: '/x', model: 'claude-opus-4-8' })
  // 读回 JSON,断言 agents 里 m1 的 model === 'claude-opus-4-8';
  // 再加一个不带 model 的,断言写回对象上没有 model 键(JSON.stringify 后不含 '"model"')。
});
```

(测试体按文件内既有 harness 写实,上面是要断言的行为;不许留 TODO,落地时写完整。)

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/bus/admin-add-model.test.ts tests/team-persist.test.ts` — Expected: 新用例 FAIL。

- [ ] **Step 3: 实现**

① `src/bus/server.ts`:

- `BusDeps.onAddAgent` 签名的 spec 加 `model?: string`:

```ts
  onAddAgent?(spec: { name: string; cli: string; cwd: string; role?: string; bootstrap?: string; model?: string }): Promise<{ ok: boolean; error?: string }>;
```

- `/admin/add` 路由调用处加 model 透传(`abody.model` 非空字符串才传):

```ts
          const r = await deps.onAddAgent({ name: String(abody.name), cli: String(abody.cli), cwd: String(abody.cwd), role: abody.role, bootstrap: abody.bootstrap, model: typeof abody.model === 'string' && abody.model ? abody.model : undefined });
```

② `src/index.ts`:

- `launchInto` 的参数类型加 `model?: string`(函数签名里的内联对象类型);
- `buildAgentLaunch` 调用处的 spec 加 `model: a.model`;
- `onAddAgent` 处理器:launchInto 成功后、写回配置文件之前,**push 进内存 cfg.agents**(修既有缺口:否则本会话内 /restart、/lead 重组都找不到该员工):

```ts
      // 修复既有缺口:不进内存 cfg.agents 的话,本会话内对该员工 /restart 报 unknown、/lead 重组也漏掉它。
      cfg.agents.push({ name: spec.name, cli: spec.cli, cwd: spec.cwd, role: spec.role, lead: false, bootstrap: spec.bootstrap ?? '', model: spec.model });
```

注意:`AgentConfig.bootstrap` 必填非空——`spec.bootstrap` 可能为空,与 team-persist 同策略由 role 派生:`spec.bootstrap && spec.bootstrap.length ? spec.bootstrap : bootstrapForRole(spec.role ?? t().wizardDefaultRole)`(`bootstrapForRole` 从 `./templates.js` 导入,team-persist.ts:28 同款)。

③ `src/team-persist.ts`:`PersistAgent` 加 `model?: string`;`addAgentToConfigFile` push 对象加 `...(agent.model ? { model: agent.model } : {})`(不带时不写键,保持配置文件干净)。

④ `src/templates.ts`:模板里 agent 对象的类型若有显式接口则加 `model?: string`;若直接是 AgentConfig 派生则 Task 1 已覆盖,本文件可能零改动——确认后如实提交。

- [ ] **Step 4: 跑测试 + 编译**

Run: `npx vitest run tests/bus/ tests/team-persist.test.ts && npx tsc -p tsconfig.build.json --noEmit` — Expected: 全绿、0 错。

- [ ] **Step 5: Commit**

```bash
git add src/bus/server.ts src/index.ts src/team-persist.ts src/templates.ts tests/bus/admin-add-model.test.ts tests/team-persist.test.ts
git commit -m "feat(core): model 全链路透传 + 修 /add 员工不进内存 cfg.agents 的缺口"
```

---

### Task 4: /add 向导加模型步

**Files:**
- Modify: `src/console/app.tsx`(WizardState、按键状态机、渲染、提交)
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`
- Test: 现有 `tests/console/wizard.test.ts` 若测的是状态机纯逻辑则追加;若向导逻辑全在 app.tsx(经查是),依赖 `tests/console/app-e2e.test.tsx` 回归 + 编译检查

- [ ] **Step 1: i18n 词条**(zh/en 同步,锚点在 wizardRoleSuffix 附近)

zh.ts:

```ts
  wizardModelSuffix: ' — 模型（Enter 下一步 · 留空=CLI 默认 · Esc 取消）',
  wizardModelHint: '例：claude-opus-4-8 / claude-fable-5。留空用 CLI 全局默认；填错会启动失败并触发 ⚠ 未报到告警。',
```

en.ts:

```ts
  wizardModelSuffix: ' — model (Enter next · blank = CLI default · Esc cancel)',
  wizardModelHint: 'e.g. claude-opus-4-8 / claude-fable-5. Blank = CLI global default; a wrong name fails to launch and trips the ⚠ no-register alarm.',
```

- [ ] **Step 2: WizardState 加 model 步**(app.tsx:33-36)

流程定为 cli → **model** → role → cwd:

```ts
type WizardState =
  | { name: string; step: 'cli'; sel: number }
  | { name: string; step: 'model'; cli: string; modelText: string }
  | { name: string; step: 'role'; cli: string; model?: string; roleText: string }
  | { name: string; step: 'cwd'; cli: string; model?: string; role: string; path: string; sel: number };
```

- [ ] **Step 3: 按键状态机**(app.tsx:306-335 一带)

- `cli` 步的 enter/tab 改为进 model 步:

```ts
        if (ev.type === 'enter' || ev.type === 'tab') { setWizard({ name: wizard.name, step: 'model', cli: CLIS[wizard.sel], modelText: '' }); return; }
```

- `cli` 步之后插入 model 步处理(仿 role 步的文本输入):

```ts
      if (wizard.step === 'model') {
        if (ev.type === 'enter') { setWizard({ name: wizard.name, step: 'role', cli: wizard.cli, model: wizard.modelText.trim() || undefined, roleText: '' }); return; }
        if (ev.type === 'backspace') { setWizard({ ...wizard, modelText: wizard.modelText.slice(0, -1) }); return; }
        if (ev.type === 'text') { setWizard({ ...wizard, modelText: wizard.modelText + ev.text }); return; }
        return;
      }
```

- `role` 步的 enter 透传 model:

```ts
        if (ev.type === 'enter') { setWizard({ name: wizard.name, step: 'cwd', cli: wizard.cli, model: wizard.model, role: wizard.roleText.trim() || t().wizardDefaultRole, path: defaultCwd, sel: 0 }); return; }
```

- `cwd` 步提交(app.tsx:326)body 加 model:

```ts
          const r = await admin(port, 'POST', '/admin/add', { name: w.name, cli: w.cli, cwd: w.path, role: w.role, model: w.model });
```

- [ ] **Step 4: 渲染块**(app.tsx:630-651 的向导浮层),`cli` 分支后插:

```tsx
            ) : wizard.step === 'model' ? (
              <>
                <Text>{t().wizardAddPrefix}<Text bold>{wizard.name}</Text> [{wizard.cli}]{t().wizardModelSuffix}</Text>
                <Box><Text color="green">› </Text><Text>{wizard.modelText}</Text><Text inverse> </Text></Box>
                <Text dimColor>{t().wizardModelHint}</Text>
              </>
```

(role 分支的标题可顺手把已选模型显示出来:`[{wizard.cli}{wizard.model ? '·' + wizard.model : ''}]`——一行改动,可选。)

- [ ] **Step 5: 验证 + Commit**

Run: `npx vitest run tests/console/ tests/i18n.test.ts && npx tsc -p tsconfig.build.json --noEmit` — Expected: 全绿。

```bash
git add src/console/app.tsx src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(console): /add 向导加模型步(cli→model→role→cwd,留空=默认)"
```

---

### Task 5: 构建 + 实机验证

- [ ] **Step 1**: `npm test && npm run build` — 全绿、0 错。**必须 build。**
- [ ] **Step 2**: 实机:在 `/tmp/falinks-model-verify` 建单员工团队(配置里 `"model": "claude-opus-4-8"`)启动,`ps -axo command | grep mcp-config` 确认命令行含 `--model claude-opus-4-8`;`/restart` 该员工,再查进程命令行仍含;`/add` 向导走一遍模型步(填一个模型),确认新员工进程命令行含 `--model` 且 `/restart` 它成功(验证 cfg.agents 缺口修复)。完毕 shutdown 清理。
- [ ] **Step 3**: Commit(若有修正)。

---

## Self-Review 结果

- **Spec 覆盖**:config 字段(T1)、claude/codex fresh+resume 参数(T2,spike 已过)、透传链+cfg.agents 缺口(T3)、向导步(T4)、错填模型由 A-1 ⚠ 兜底(文案写进 wizardModelHint)、有意不做(setup 向导/roster 显示)未引入。
- **占位扫描**:team-persist 测试给的是行为断言清单+harness 指引,其余全代码;无 TBD。
- **类型一致**:`model?: string` 贯穿 AgentConfig/LaunchSpec/PersistAgent/onAddAgent spec/WizardState;`shQuote` 来源 `../terminal/iterm.js`(mcp-config.ts 已有导入)。

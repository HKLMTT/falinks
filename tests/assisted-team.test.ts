// 「组长 + 助理组」预设 验收 —— 契约稿 docs/ASSISTANT-TEAM-DESIGN.md §8。
//
// 两段式(同 multi-office 思路):
//   ① always-on:现在就跑——既有预设回归(solo/pair/fullstack/research 不变)、configFromMembers
//      的 lead 透传、config 校验 lead 取布尔、决策工具门禁(助理=非 lead 天然被拒,现有门禁即覆盖)。
//   ② skipIf:backend schema/预设落地后自动激活——assisted 预设、assistant 字段透传、assistant
//      校验 + (assistant&&lead 互斥)、assisted 的 i18n、composeBootstrap 分支。未落地整组 skip,
//      保持 npm test 全绿。
//
// ⚠ 待 backend 对齐(lead 会转签名,届时 qa 收口):
//   - assistant 字段最终命名(本文件按契约 `assistant: boolean`);
//   - i18n 新 key 名(assistantRules / coordinator addendum / 3 个 role 名)——下方用候选名探测;
//   - ★ composeBootstrap 目前是 index.ts 内的私有闭包,无法直接单测。需 backend 把组合逻辑抽成
//     【可测的纯函数并导出】(lead 已知会让 backend 留意)。本文件按"能拿到某 agent 最终 bootstrap
//     文本做包含断言"设计,探测候选导出;拿不到则该组 skip,等签名定后我收口。
//   - ★ 既有 tests/templates.test.ts:6 用 toEqual(['solo','pair','fullstack','research']) 精确断言,
//     backend 加 assisted 后该行会红 —— 需 backend 在提交里同步把它改成包含式(本文件用 toContain)。

import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { presetTeams, configFromMembers } from '../src/templates.js';
import { parseConfig } from '../src/core/config.js';
import { Router } from '../src/core/router.js';
import { makeDeliverer } from '../src/orchestrator.js';
import { FakeDriver } from '../src/terminal/driver.js';
import { startBus, type Bus } from '../src/bus/server.js';
import { setLocale } from '../src/i18n/index.js';
import { zh } from '../src/i18n/zh.js';
import { en } from '../src/i18n/en.js';

// ════════════════════════════════════════════════════════════════════════
// ① 回归 always-on:既有预设 / lead 透传 / lead 校验 不因新增 assisted 而变。
// ════════════════════════════════════════════════════════════════════════
describe('回归:既有预设不变', () => {
  test('solo/pair/fullstack/research 仍在且成员数不变(包含式,容纳新增 assisted)', () => {
    const ids = presetTeams().map((t) => t.id);
    for (const id of ['solo', 'pair', 'fullstack', 'research']) expect(ids).toContain(id);
    const by = (id: string) => presetTeams().find((t) => t.id === id)!;
    expect(by('solo').members).toHaveLength(1);
    expect(by('pair').members).toHaveLength(2);
    expect(by('fullstack').members).toHaveLength(5);
    expect(by('research').members).toHaveLength(3);
  });

  test('fullstack:唯一 lead 标 lead:true,无成员标 assistant', () => {
    const fs = presetTeams().find((t) => t.id === 'fullstack')!;
    const leads = fs.members.filter((m) => m.lead === true);
    expect(leads).toHaveLength(1);
    expect(leads[0].name).toBe('lead');
    expect(fs.members.every((m) => (m as any).assistant !== true)).toBe(true);
  });

  test('research:无 lead、无 assistant(纯 worker 组)', () => {
    const rs = presetTeams().find((t) => t.id === 'research')!;
    expect(rs.members.every((m) => m.lead !== true)).toBe(true);
    expect(rs.members.every((m) => (m as any).assistant !== true)).toBe(true);
  });
});

describe('回归:configFromMembers 的 lead 透传不变', () => {
  test('lead 成员 → agent.lead===true;非 lead → 不带 lead', () => {
    const cfg = configFromMembers(
      [
        { name: 'lead', cli: 'claude', role: '组长', lead: true },
        { name: 'dev', cli: 'claude', role: '开发' },
      ],
      '/proj',
    );
    const lead = cfg.agents.find((a: any) => a.name === 'lead')!;
    const dev = cfg.agents.find((a: any) => a.name === 'dev')!;
    expect(lead.lead).toBe(true);
    expect(dev.lead).toBeFalsy();
  });
});

describe('回归:config 校验 lead 取布尔', () => {
  const agent = (extra: Record<string, unknown> = {}) => ({ name: 'a', cli: 'claude', cwd: '/p', bootstrap: 'b', ...extra });
  test('lead 非 true 一律归一为 false', () => {
    expect(parseConfig({ agents: [agent({ lead: true })] }).agents[0].lead).toBe(true);
    expect(parseConfig({ agents: [agent({ lead: 'yes' })] }).agents[0].lead).toBe(false);
    expect(parseConfig({ agents: [agent()] }).agents[0].lead).toBe(false);
  });
});

// ── 决策工具门禁(always-on):助理 = 非 lead,现有 .lead 门禁即拒 ────────────────
describe('决策工具门禁:助理(非 lead)调 todoplan/taskdone 被拒', () => {
  let bus: Bus;
  let router: Router;

  beforeEach(async () => {
    const driver = new FakeDriver();
    let n = 0;
    router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
    router.addAgent('lead', undefined, true);          // 组长
    router.addAgent('researcher', undefined, false, true); // 助理(assistant:true,非 lead)
    bus = await startBus({
      router,
      getSessionId: () => undefined,
      todo: {
        taskdone: () => ({ ok: true }),
        taskwait: () => ({ ok: true }),
        op: () => ({ ok: true }),
        state: () => ({ state: 'idle', nudgeMinutes: 10, tasks: [] }),
        plan: () => ({ ok: true, seqs: [1] }),
        leadstate: () => ({ ok: true }),
      },
    }, 0);
  });
  afterEach(async () => { await bus.close(); });

  const call = async (agent: string, name: string, args: Record<string, unknown> = {}) => {
    const url = new URL(`http://127.0.0.1:${bus.port}/agent/${agent}/mcp`);
    const client = new Client({ name: `c-${agent}`, version: '1.0.0' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(url));
    const res: any = await client.callTool({ name, arguments: args });
    await client.close();
    return JSON.parse(res.content[0].text);
  };

  test('researcher 调 todoplan 被拒(只有 lead 能)', async () => {
    const r = await call('researcher', 'todoplan', { tasks: ['a'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lead/);
  });

  test('researcher 调 taskdone 被拒', async () => {
    const r = await call('researcher', 'taskdone', { seq: 1, status: 'done', result: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lead/);
  });

  test('对照:lead 调 todoplan 放行', async () => {
    const r = await call('lead', 'todoplan', { tasks: ['a'] });
    expect(r.ok).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// ② skipIf:backend assisted 预设 / assistant 标记落地后自动激活。
// ════════════════════════════════════════════════════════════════════════
const hasAssisted = presetTeams().some((t) => t.id === 'assisted');

const supportsAssistantField = (() => {
  try {
    const c = configFromMembers([{ name: 'x', cli: 'claude', role: 'r', assistant: true } as any], '/p');
    return (c.agents[0] as any).assistant === true;
  } catch { return false; }
})();

const supportsAssistantValidation = (() => {
  try {
    const c = parseConfig({ agents: [{ name: 'a', cli: 'claude', cwd: '/p', bootstrap: 'b', assistant: true }] });
    return (c.agents[0] as any).assistant === true;
  } catch { return false; }
})();

// ── assisted 预设组成 ──────────────────────────────────────────────────────
describe.skipIf(!hasAssisted)('§8 预设 assisted = lead + 3 助理', () => {
  test('成员数 4:1 组长 + 3 助理,flag 正确', () => {
    const a = presetTeams().find((t) => t.id === 'assisted')!;
    expect(a.members).toHaveLength(4);
    const leads = a.members.filter((m) => m.lead === true);
    const assistants = a.members.filter((m) => (m as any).assistant === true);
    expect(leads).toHaveLength(1);
    expect(assistants).toHaveLength(3);
    // lead 非 assistant、3 助理皆非 lead(互斥)
    expect((leads[0] as any).assistant).not.toBe(true);
    expect(assistants.every((m) => m.lead !== true)).toBe(true);
  });

  test('每个成员 role 非空字符串', () => {
    const a = presetTeams().find((t) => t.id === 'assisted')!;
    for (const m of a.members) expect(typeof m.role === 'string' && m.role.length > 0).toBe(true);
  });
});

// ── configFromMembers 透传 assistant ───────────────────────────────────────
describe.skipIf(!supportsAssistantField)('§8 configFromMembers 透传 assistant', () => {
  test('member.assistant → agent.assistant;lead 仍各自正确', () => {
    const cfg = configFromMembers(
      [
        { name: 'lead', cli: 'claude', role: '组长', lead: true } as any,
        { name: 'researcher', cli: 'claude', role: '调研', assistant: true } as any,
      ],
      '/proj',
    );
    const lead = cfg.agents.find((a: any) => a.name === 'lead') as any;
    const res = cfg.agents.find((a: any) => a.name === 'researcher') as any;
    expect(res.assistant).toBe(true);
    expect(res.lead).toBeFalsy();
    expect(lead.lead).toBe(true);
    expect(lead.assistant).toBeFalsy();
  });
});

// ── config 校验:assistant 取布尔 + (assistant && lead) 互斥 ─────────────────
describe.skipIf(!supportsAssistantValidation)('§8 config 校验 assistant', () => {
  const agent = (extra: Record<string, unknown> = {}) => ({ name: 'a', cli: 'claude', cwd: '/p', bootstrap: 'b', ...extra });

  test('assistant 取布尔(非 true 归一 false)', () => {
    expect((parseConfig({ agents: [agent({ assistant: true })] }).agents[0] as any).assistant).toBe(true);
    expect((parseConfig({ agents: [agent({ assistant: 'y' })] }).agents[0] as any).assistant).toBe(false);
    expect((parseConfig({ agents: [agent()] }).agents[0] as any).assistant).toBe(false);
  });

  test('assistant && lead 同真 → 抛错(互斥)', () => {
    expect(() => parseConfig({ agents: [agent({ assistant: true, lead: true })] })).toThrow();
  });
});

// ── i18n:assisted 相关 key 的 zh/en parity(全局 key 数 parity 已有 i18n.test;此处按名校验)──
const ASSIST_RULE_KEYS = ['assistantRules', 'assistantBootstrap'];
const ADDENDUM_KEYS = ['coordinatorAssistAddendum', 'coordinatorAssistantAddendum', 'coordinatorAddendum', 'leadAssistantAddendum', 'assistantAddendum'];
const resolveStrKey = (cands: string[]) =>
  cands.find((k) => typeof (zh as any)[k] === 'string' && typeof (en as any)[k] === 'string');

describe.skipIf(!hasAssisted)('§8 i18n parity:assisted role 名 + assistantRules/addendum', () => {
  test('assisted 各成员 role 在 zh/en 均非空,且翻译有别', () => {
    setLocale('zh');
    const zhRoles = presetTeams().find((t) => t.id === 'assisted')!.members.map((m) => m.role);
    setLocale('en');
    const enRoles = presetTeams().find((t) => t.id === 'assisted')!.members.map((m) => m.role);
    setLocale('zh');
    expect(zhRoles.every((r) => r.length > 0)).toBe(true);
    expect(enRoles.every((r) => r.length > 0)).toBe(true);
    expect(zhRoles).not.toEqual(enRoles); // 已翻译(非照搬)
  });

  test('assistantRules / coordinator addendum 两套文案 zh+en 均存在且非空', () => {
    const ar = resolveStrKey(ASSIST_RULE_KEYS);
    const ad = resolveStrKey(ADDENDUM_KEYS);
    expect(ar, `assistantRules key 未找到(候选 ${ASSIST_RULE_KEYS.join('/')}),待 backend 对齐键名`).toBeTruthy();
    expect(ad, `addendum key 未找到(候选 ${ADDENDUM_KEYS.join('/')}),待 backend 对齐键名`).toBeTruthy();
    if (ar) { expect((zh as any)[ar].length).toBeGreaterThan(0); expect((en as any)[ar].length).toBeGreaterThan(0); }
    if (ad) { expect((zh as any)[ad].length).toBeGreaterThan(0); expect((en as any)[ad].length).toBeGreaterThan(0); }
  });
});

// ── §8#4 composeBootstrap 四分支 ──────────────────────────────────────────
// 已由 backend 抽成纯函数 composeBootstrap(agent, team) 导出于 src/templates.ts,
// 并在 tests/templates.test.ts 加了等价 4 条断言(①assistant 含 assistantRules 不含 coordinatorRules;
// ②assisted lead 含 coordinatorRules+coordinatorAssistAddendum;③fullstack lead 不含 addendum;
// ④worker 不含 assistantRules)。§8#4 由那 4 条独家覆盖,此处不再重复,避免两份漂移。


import { expect, test } from 'vitest';
import { presetTeams, bootstrapForRole, configFromMembers } from '../src/templates.js';
import { composeBootstrap } from '../src/core/bootstrap.js';
import { zh } from '../src/i18n/zh.js';

test('composeBootstrap:助理含 assistantRules、不含 coordinatorRules', () => {
  const cfg = { agents: [{ assistant: true }, {}] };
  const s = composeBootstrap({ name: 'researcher', role: 'r', assistant: true, bootstrap: 'B' }, cfg);
  expect(s).toContain(zh.assistantRules);
  expect(s).not.toContain(zh.coordinatorRules);
  expect(s).toContain(zh.houseRules); // 仍含基本身份/房规
});

test('composeBootstrap:有助理团队的 lead 含 coordinatorRules + addendum', () => {
  const cfg = { agents: [{ assistant: false }, { assistant: true }] };
  const s = composeBootstrap({ name: 'lead', role: 'l', lead: true, bootstrap: 'B' }, cfg);
  expect(s).toContain(zh.coordinatorRules);
  expect(s).toContain(zh.coordinatorAssistAddendum);
  expect(s).not.toContain(zh.assistantRules);
});

test('composeBootstrap:无助理团队(fullstack)的 lead 含 coordinatorRules 但不含 addendum', () => {
  const cfg = { agents: [{}, {}, {}] }; // 无 assistant
  const s = composeBootstrap({ name: 'lead', role: 'l', lead: true, bootstrap: 'B' }, cfg);
  expect(s).toContain(zh.coordinatorRules);
  expect(s).not.toContain(zh.coordinatorAssistAddendum);
});

test('composeBootstrap:普通 worker 不含 assistantRules / coordinatorRules', () => {
  const cfg = { agents: [{ assistant: true }, {}] };
  const s = composeBootstrap({ name: 'frontend', role: 'f', bootstrap: 'B' }, cfg);
  expect(s).not.toContain(zh.assistantRules);
  expect(s).not.toContain(zh.coordinatorRules);
});

test('composeBootstrap:leadStateDoc 仅 lead 拼接、locale 可指定', () => {
  const cfg = { agents: [{ assistant: true }] };
  const lead = composeBootstrap({ name: 'lead', lead: true }, cfg, { leadStateDoc: 'DOC-XYZ' });
  expect(lead).toContain('DOC-XYZ');
  // 非 lead 即使传 doc 也不拼接
  const asst = composeBootstrap({ name: 'researcher', assistant: true }, cfg, { leadStateDoc: 'DOC-XYZ' });
  expect(asst).not.toContain('DOC-XYZ');
  // locale=en 取英文串(不改全局)
  const enText = composeBootstrap({ name: 'r', assistant: true }, cfg, { locale: 'en' });
  expect(enText).not.toContain(zh.assistantRules); // 不是中文那条
});

test('presets include solo/pair/fullstack/research/assisted with members', () => {
  const ids = presetTeams().map((t) => t.id);
  expect(ids).toEqual(['solo', 'pair', 'fullstack', 'research', 'assisted']);
  expect(presetTeams().find((t) => t.id === 'solo')!.members).toHaveLength(1);
  expect(presetTeams().find((t) => t.id === 'fullstack')!.members).toHaveLength(5);
});

test('assisted 预设:lead + 3 助理,flag 正确、互不为 lead', () => {
  const a = presetTeams().find((t) => t.id === 'assisted')!;
  expect(a.members).toHaveLength(4);
  const lead = a.members.find((m) => m.name === 'lead')!;
  expect(lead.lead).toBe(true);
  expect(lead.assistant).toBeFalsy();
  const assistants = a.members.filter((m) => m.assistant);
  expect(assistants.map((m) => m.name)).toEqual(['researcher', 'curator', 'drafter']);
  expect(assistants.every((m) => !m.lead)).toBe(true);
});

test('every preset member has name/cli/role', () => {
  for (const t of presetTeams()) {
    for (const m of t.members) {
      expect(m.name).toBeTruthy();
      expect(m.cli).toBeTruthy();
      expect(m.role).toBeTruthy();
    }
  }
});

test('bootstrapForRole embeds the role', () => {
  expect(bootstrapForRole('后端开发')).toContain('后端开发');
});

test('configFromMembers maps members to agents at the given cwd with derived bootstrap', () => {
  const cfg = configFromMembers([{ name: 'bob', cli: 'codex', role: '后端' }], '/proj');
  expect('busPort' in cfg).toBe(false);
  expect(cfg.agents).toEqual([
    { name: 'bob', cli: 'codex', cwd: '/proj', role: '后端', bootstrap: bootstrapForRole('后端') },
  ]);
  expect(cfg.routes).toEqual({});
});

test('fullstack 预设的 lead 成员标记 lead:true,其余不标', () => {
  const fs = presetTeams().find((t) => t.id === 'fullstack')!;
  const lead = fs.members.find((m) => m.name === 'lead')!;
  expect(lead.lead).toBe(true);
  expect(fs.members.filter((m) => m.lead).length).toBe(1);
});

test('configFromMembers 仅给 lead 成员透传 lead:true', () => {
  const cfg = configFromMembers([
    { name: 'lead', cli: 'claude', role: '组长', lead: true },
    { name: 'dev', cli: 'claude', role: '开发' },
  ], '/proj');
  expect((cfg.agents[0] as any).lead).toBe(true);
  expect('lead' in cfg.agents[1]).toBe(false);
});

test('configFromMembers:成员有 cwd 用自己的,没有则回退团队 cwd', () => {
  const cfg = configFromMembers([
    { name: 'a', cli: 'claude', role: 'x', cwd: '/proj/web' },
    { name: 'b', cli: 'claude', role: 'y' },
  ], '/proj');
  expect(cfg.agents[0].cwd).toBe('/proj/web');
  expect(cfg.agents[1].cwd).toBe('/proj');
});

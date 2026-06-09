import { expect, test } from 'vitest';
import { presetTeams, bootstrapForRole, configFromMembers } from '../src/templates.js';

test('presets include solo/pair/fullstack/research with members', () => {
  const ids = presetTeams().map((t) => t.id);
  expect(ids).toEqual(['solo', 'pair', 'fullstack', 'research']);
  expect(presetTeams().find((t) => t.id === 'solo')!.members).toHaveLength(1);
  expect(presetTeams().find((t) => t.id === 'fullstack')!.members).toHaveLength(5);
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

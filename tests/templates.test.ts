import { expect, test } from 'vitest';
import { PRESET_TEMPLATES, bootstrapForRole, configFromMembers } from '../src/templates.js';

test('presets include solo/pair/fullstack/research with members', () => {
  const ids = PRESET_TEMPLATES.map((t) => t.id);
  expect(ids).toEqual(['solo', 'pair', 'fullstack', 'research']);
  expect(PRESET_TEMPLATES.find((t) => t.id === 'solo')!.members).toHaveLength(1);
  expect(PRESET_TEMPLATES.find((t) => t.id === 'fullstack')!.members).toHaveLength(4);
});

test('every preset member has name/cli/role', () => {
  for (const t of PRESET_TEMPLATES) {
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

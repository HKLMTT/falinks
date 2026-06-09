import { expect, test } from 'vitest';
import { commandState, applyCommand, COMMANDS } from '../../src/console/commands.js';

test('bare / activates with all commands', () => {
  const s = commandState('/');
  expect(s.active).toBe(true);
  expect(s.matches.map((c) => c.name)).toEqual(['add', 'remove', 'clear', 'filter', 'lang', 'mouse', 'help']);
});

test('/a matches add', () => {
  expect(commandState('/a').matches.map((c) => c.name)).toEqual(['add']);
});

test('/r matches remove', () => {
  expect(commandState('/r').matches.map((c) => c.name)).toEqual(['remove']);
});

test('/h matches help', () => {
  expect(commandState('/h').matches.map((c) => c.name)).toEqual(['help']);
});

test('case-insensitive', () => {
  expect(commandState('/A').matches.map((c) => c.name)).toEqual(['add']);
});

test('/ with a space (args started) is no longer active', () => {
  expect(commandState('/add foo').active).toBe(false);
});

test('no leading slash -> inactive', () => {
  expect(commandState('add foo').active).toBe(false);
});

test('/zzz no match -> inactive', () => {
  expect(commandState('/zzz').active).toBe(false);
});

test('every command carries a usage string', () => {
  for (const c of COMMANDS) expect(c.usage.startsWith(`/${c.name}`)).toBe(true);
});

test('applyCommand yields /<name> + space', () => {
  expect(applyCommand('add')).toBe('/add ');
});

test('lang/help 标记为无参命令(补全时直接执行,不补尾空格)', () => {
  const byName = Object.fromEntries(COMMANDS.map((c) => [c.name, c]));
  expect(byName.lang.noArgs).toBe(true);
  expect(byName.help.noArgs).toBe(true);
  expect(byName.add.noArgs).toBeUndefined();
  expect(byName.remove.noArgs).toBeUndefined();
  expect(byName.clear.noArgs).toBeUndefined();
});

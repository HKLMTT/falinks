import { expect, test } from 'vitest';
import { commandState, applyCommand, COMMANDS } from '../../src/console/commands.js';

test('bare / activates with all commands', () => {
  const s = commandState('/');
  expect(s.active).toBe(true);
  expect(s.matches.map((c) => c.name)).toEqual(['add', 'remove', 'help']);
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

import { expect, test } from 'vitest';
import { parseConsoleInput } from '../../src/console/parse.js';

test('@name message -> say', () => {
  expect(parseConsoleInput('@alice 在吗')).toEqual({ kind: 'say', to: 'alice', message: '在吗' });
});

test('plain text -> broadcast', () => {
  expect(parseConsoleInput('全体开会')).toEqual({ kind: 'broadcast', message: '全体开会' });
});

test('/add name cli cwd -> add', () => {
  expect(parseConsoleInput('/add carol claude /tmp/c')).toEqual({
    kind: 'add', spec: { name: 'carol', cli: 'claude', cwd: '/tmp/c' },
  });
});

test('/remove name -> remove', () => {
  expect(parseConsoleInput('/remove bob')).toEqual({ kind: 'remove', name: 'bob' });
});

test('/help -> help', () => {
  expect(parseConsoleInput('/help').kind).toBe('help');
});

test('/add name (one arg) -> add-start (wizard)', () => {
  expect(parseConsoleInput('/add carol')).toEqual({ kind: 'add-start', name: 'carol' });
});

test('/add with two args -> error', () => {
  expect(parseConsoleInput('/add carol claude').kind).toBe('error');
});

test('empty input -> noop', () => {
  expect(parseConsoleInput('   ').kind).toBe('noop');
});

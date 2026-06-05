import { expect, test } from 'vitest';
import { parseConsoleInput, lastReplyTarget } from '../../src/console/parse.js';

test('@name message -> say', () => {
  expect(parseConsoleInput('@alice 在吗')).toEqual({ kind: 'say', to: 'alice', message: '在吗' });
});

test('@all message -> broadcast', () => {
  expect(parseConsoleInput('@all 全体开会')).toEqual({ kind: 'broadcast', message: '全体开会' });
});

test('plain text -> reply (回复上次目标,不再群发)', () => {
  expect(parseConsoleInput('继续')).toEqual({ kind: 'reply', message: '继续' });
});

test('lastReplyTarget: boss 最近发给谁就是谁', () => {
  const log = [
    { from: 'boss', to: 'lead' },
    { from: 'lead', to: 'boss' },
    { from: 'boss', to: 'qa' },
  ];
  expect(lastReplyTarget(log)).toBe('qa');
});

test('lastReplyTarget: 最近一条是别人发给 boss,则目标=发信人', () => {
  const log = [
    { from: 'boss', to: 'lead' },
    { from: 'frontend', to: 'boss' },
  ];
  expect(lastReplyTarget(log)).toBe('frontend');
});

test('lastReplyTarget: 不沾 boss 的消息忽略;无相关返回 null', () => {
  expect(lastReplyTarget([{ from: 'a', to: 'b' }])).toBeNull();
  expect(lastReplyTarget([])).toBeNull();
});

test('/clear 不带名 -> 全员清', () => {
  expect(parseConsoleInput('/clear')).toEqual({ kind: 'clear', name: undefined });
});

test('/clear name -> 指定员工(允许 @ 前缀)', () => {
  expect(parseConsoleInput('/clear lead')).toEqual({ kind: 'clear', name: 'lead' });
  expect(parseConsoleInput('/clear @lead')).toEqual({ kind: 'clear', name: 'lead' });
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

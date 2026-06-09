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

test('/lang (no args) -> lang-start', () => {
  expect(parseConsoleInput('/lang')).toEqual({ kind: 'lang-start' });
});

test('/lang with arg -> error (no args accepted)', () => {
  expect(parseConsoleInput('/lang xx').kind).toBe('error');
});

test('/lead (no args) -> lead-start', () => {
  expect(parseConsoleInput('/lead')).toEqual({ kind: 'lead-start' });
});

test('/lead with arg -> error (no args accepted)', () => {
  expect(parseConsoleInput('/lead bob').kind).toBe('error');
});

// 回归:图片占位 [图片N] 开头的输入是"回复",不是命令。
// (修 bug:粘贴图片展开成 /var/...png 后若先展开再解析,会被当成命令。现在用原始输入判命令。)
test('[图片N] 开头按回复处理(不被当命令);命令判定基于原始输入而非展开后的 /路径', () => {
  expect(parseConsoleInput('[图片1]')).toEqual({ kind: 'reply', message: '[图片1]' });
  expect(parseConsoleInput('[图片1] 看这个')).toEqual({ kind: 'reply', message: '[图片1] 看这个' });
  // 反例:若误把展开后的路径拿去解析,就会被当成(未知)命令
  expect(parseConsoleInput('/var/folders/x/clip.png 看这个').kind).toBe('error');
});

test('empty input -> noop', () => {
  expect(parseConsoleInput('   ').kind).toBe('noop');
});

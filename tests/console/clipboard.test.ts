import { expect, test } from 'vitest';
import { expandImageTokens } from '../../src/console/clipboard.js';

test('expands [图片N] to the matching path', () => {
  const paths = ['/tmp/a.png', '/tmp/b.png'];
  expect(expandImageTokens('@bob 看这个 [图片1]', paths)).toBe('@bob 看这个 /tmp/a.png');
  expect(expandImageTokens('对比 [图片1] 和 [图片2]', paths)).toBe('对比 /tmp/a.png 和 /tmp/b.png');
});

test('leaves unknown tokens as-is', () => {
  expect(expandImageTokens('[图片3]', ['/tmp/a.png'])).toBe('[图片3]');
});

test('no tokens -> unchanged', () => {
  expect(expandImageTokens('普通消息', [])).toBe('普通消息');
});

test('英文占位符 [Image N] 同样展开(切语言后旧占位符也不失效)', () => {
  const paths = ['/tmp/a.png'];
  expect(expandImageTokens('@bob see [Image 1]', paths)).toBe('@bob see /tmp/a.png');
  expect(expandImageTokens('混用 [图片1] and [Image 1]', paths)).toBe('混用 /tmp/a.png and /tmp/a.png');
});

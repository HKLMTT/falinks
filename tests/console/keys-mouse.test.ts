import { expect, test } from 'vitest';
import { decodeKey } from '../../src/console/keys.js';

test('SGR 鼠标滚轮:上滚 → wheel-up,下滚 → wheel-down', () => {
  expect(decodeKey('\x1b[<64;10;5M')).toEqual({ type: 'wheel-up' });
  expect(decodeKey('\x1b[<65;10;5M')).toEqual({ type: 'wheel-down' });
});

test('带修饰键的滚轮仍识别方向(ctrl+滚轮=80/81)', () => {
  expect(decodeKey('\x1b[<80;1;1M')).toEqual({ type: 'wheel-up' });
  expect(decodeKey('\x1b[<81;1;1M')).toEqual({ type: 'wheel-down' });
});

test('鼠标点击/释放被吞成 mouse 事件(不当文字插入输入框)', () => {
  expect(decodeKey('\x1b[<0;12;3M')).toEqual({ type: 'mouse' }); // 左键按下
  expect(decodeKey('\x1b[<0;12;3m')).toEqual({ type: 'mouse' }); // 释放
});

test('普通方向键/PageUp 不受鼠标解码影响', () => {
  expect(decodeKey('\x1b[A')).toEqual({ type: 'up' });
  expect(decodeKey('\x1b[5~')).toEqual({ type: 'pageup' });
});

import { expect, test } from 'vitest';
import { decodeKey } from '../../src/console/keys.js';

test('文字:字母与中文(含粘贴的多字)都识别为 text', () => {
  expect(decodeKey('a')).toEqual({ type: 'text', text: 'a' });
  expect(decodeKey('你好')).toEqual({ type: 'text', text: '你好' });
  expect(decodeKey('nihao')).toEqual({ type: 'text', text: 'nihao' });
});

test('回车:传统 CR / LF 都是 enter', () => {
  expect(decodeKey('\r')).toEqual({ type: 'enter' });
  expect(decodeKey('\n')).toEqual({ type: 'enter' });
});

test('Shift+Enter: kitty CSI-u code=13 mods=Shift', () => {
  expect(decodeKey('\x1b[13;2u')).toEqual({ type: 'shift-enter' });
});

test('kitty 普通 Enter(若以 CSI-u 形式来)= enter', () => {
  expect(decodeKey('\x1b[13u')).toEqual({ type: 'enter' });
});

test('方向键(传统序列)', () => {
  expect(decodeKey('\x1b[A')).toEqual({ type: 'up' });
  expect(decodeKey('\x1b[B')).toEqual({ type: 'down' });
  expect(decodeKey('\x1b[C')).toEqual({ type: 'right' });
  expect(decodeKey('\x1b[D')).toEqual({ type: 'left' });
});

test('退格 / Tab / Esc', () => {
  expect(decodeKey('\x7f')).toEqual({ type: 'backspace' });
  expect(decodeKey('\t')).toEqual({ type: 'tab' });
  expect(decodeKey('\x1b')).toEqual({ type: 'esc' });
});

test('Home / End(多种序列)', () => {
  expect(decodeKey('\x1b[H')).toEqual({ type: 'home' });
  expect(decodeKey('\x1b[F')).toEqual({ type: 'end' });
  expect(decodeKey('\x1b[1~')).toEqual({ type: 'home' });
  expect(decodeKey('\x1b[4~')).toEqual({ type: 'end' });
});

test('Ctrl+C / Ctrl+V:kitty CSI-u 与传统单字节都识别', () => {
  expect(decodeKey('\x1b[99;5u')).toEqual({ type: 'ctrl', key: 'c' }); // kitty: code=99('c'),mods=5→ctrl
  expect(decodeKey('\x1b[118;5u')).toEqual({ type: 'ctrl', key: 'v' });
  expect(decodeKey('\x03')).toEqual({ type: 'ctrl', key: 'c' }); // 传统 0x03
  expect(decodeKey('\x16')).toEqual({ type: 'ctrl', key: 'v' }); // 传统 0x16
});

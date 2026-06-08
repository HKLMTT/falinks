import { expect, test } from 'vitest';
import { decodeKey } from '../../src/console/keys.js';

test('PageUp / PageDown → pageup/pagedown(回看历史用,避开 macOS Ctrl+↑↓ 系统热键)', () => {
  expect(decodeKey('\x1b[5~')).toEqual({ type: 'pageup' });
  expect(decodeKey('\x1b[6~')).toEqual({ type: 'pagedown' });
});

test('普通方向键不受影响', () => {
  expect(decodeKey('\x1b[A')).toEqual({ type: 'up' });
  expect(decodeKey('\x1b[B')).toEqual({ type: 'down' });
});

test('Home/End(\\x1b[1~ / \\x1b[4~)不被 PageUp/Down 误吞', () => {
  expect(decodeKey('\x1b[1~')).toEqual({ type: 'home' });
  expect(decodeKey('\x1b[4~')).toEqual({ type: 'end' });
});

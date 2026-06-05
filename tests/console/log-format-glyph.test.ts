import { expect, test } from 'vitest';
import { statusGlyph, SPINNER_FRAMES } from '../../src/console/log-format.js';

test('在忙/启动中 → spinner 当前帧(动起来)', () => {
  expect(statusGlyph('busy', false, 0)).toBe(SPINNER_FRAMES[0]);
  expect(statusGlyph('busy', false, 1)).toBe(SPINNER_FRAMES[1]);
  expect(statusGlyph('launching', false, 2)).toBe(SPINNER_FRAMES[2]);
});

test('frame 超出帧数自动取模回绕', () => {
  expect(statusGlyph('busy', false, SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0]);
  expect(statusGlyph('busy', false, SPINNER_FRAMES.length + 3)).toBe(SPINNER_FRAMES[3]);
});

test('空闲/挂掉 → 静态实心点(不动)', () => {
  expect(statusGlyph('idle', false, 5)).toBe('●');
  expect(statusGlyph('dead', false, 5)).toBe('●');
});

test('虚拟成员(boss)→ 小圆点,不随 frame 变', () => {
  expect(statusGlyph('idle', true, 0)).toBe('·');
  expect(statusGlyph('busy', true, 3)).toBe('·');
});

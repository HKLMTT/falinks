import { expect, test } from 'vitest';
import { NAME_COLORS, PANE_BG_COLORS, paneBgColor, hexToAppleRGB } from '../../src/console/log-format.js';

test('PANE_BG_COLORS 与 NAME_COLORS 等长(逐位对齐,保证 pane 底色与花名册配色同下标对应)', () => {
  expect(PANE_BG_COLORS.length).toBe(NAME_COLORS.length);
  for (const c of PANE_BG_COLORS) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
});

test('paneBgColor 按下标取色、越界回绕、与 PANE_BG_COLORS 一致', () => {
  expect(paneBgColor(0)).toBe(PANE_BG_COLORS[0]);
  expect(paneBgColor(3)).toBe(PANE_BG_COLORS[3]);
  expect(paneBgColor(PANE_BG_COLORS.length)).toBe(PANE_BG_COLORS[0]); // 回绕
  expect(paneBgColor(PANE_BG_COLORS.length + 2)).toBe(PANE_BG_COLORS[2]);
});

test('hexToAppleRGB:#rrggbb → 0..65535 三通道(*257)', () => {
  expect(hexToAppleRGB('#000000')).toEqual([0, 0, 0]);
  expect(hexToAppleRGB('#ffffff')).toEqual([65535, 65535, 65535]);
  expect(hexToAppleRGB('#ff8800')).toEqual([65535, 0x88 * 257, 0]); // [65535, 34952, 0]
  expect(hexToAppleRGB('ff8800')).toEqual([65535, 0x88 * 257, 0]);   // 容忍无 # 前缀
});

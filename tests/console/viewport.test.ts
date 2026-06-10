import { expect, test } from 'vitest';
import { dispWidth, wrapSegs, clampOffset, sliceView, type StyledSeg } from '../../src/console/scrollback.js';
import { wheelBurst } from '../../src/console/keys.js';

const s = (text: string, extra: Partial<StyledSeg> = {}): StyledSeg => ({ text, ...extra });

test('dispWidth:ASCII=1,CJK/全角/emoji=2', () => {
  expect(dispWidth('abc')).toBe(3);
  expect(dispWidth('中文')).toBe(4);
  expect(dispWidth('ａ１')).toBe(4);
  expect(dispWidth('a中b')).toBe(4);
  expect(dispWidth('🙂')).toBe(2);
  expect(dispWidth('')).toBe(0);
});

test('wrapSegs:不超宽不折,样式原样保留', () => {
  const rows = wrapSegs([s('hello ', { dim: true }), s('world', { bold: true })], 20);
  expect(rows).toEqual([[{ text: 'hello ', dim: true }, { text: 'world', bold: true }]]);
});

test('wrapSegs:超宽按显示列折行,CJK 不劈半个字', () => {
  // 宽度 4:每行最多 2 个汉字
  const rows = wrapSegs([s('中文折行')], 4);
  expect(rows.map((r) => r.map((x) => x.text).join(''))).toEqual(['中文', '折行']);
});

test('wrapSegs:跨片段折行,样式跟随各自片段', () => {
  const rows = wrapSegs([s('abc', { bold: true }), s('def', { dim: true })], 4);
  expect(rows).toEqual([
    [{ text: 'abc', bold: true }, { text: 'd', dim: true }],
    [{ text: 'ef', dim: true }],
  ]);
});

test('wrapSegs:CJK 撞行尾(剩 1 列放不下 2 列字)提前折', () => {
  const rows = wrapSegs([s('a中b')], 2); // a 后剩 1 列,中(2列)折到下一行
  expect(rows.map((r) => r.map((x) => x.text).join(''))).toEqual(['a', '中', 'b']);
});

test('wrapSegs:空行占一行;width<=0 不折', () => {
  expect(wrapSegs([], 10)).toEqual([[]]);
  expect(wrapSegs([s('whatever')], 0)).toEqual([[{ text: 'whatever' }]]);
});

test('clampOffset:0=贴底;封顶 total-viewH;内容不足一屏恒 0', () => {
  expect(clampOffset(0, 100, 20)).toBe(0);
  expect(clampOffset(50, 100, 20)).toBe(50);
  expect(clampOffset(999, 100, 20)).toBe(80);
  expect(clampOffset(-3, 100, 20)).toBe(0);
  expect(clampOffset(10, 5, 20)).toBe(0);
});

test('sliceView:offset=0 取末尾 count 行;offset>0 往上挪;越界取空/取头', () => {
  const lines = ['a', 'b', 'c', 'd', 'e'];
  expect(sliceView(lines, 0, 3)).toEqual(['c', 'd', 'e']);
  expect(sliceView(lines, 1, 3)).toEqual(['b', 'c', 'd']);
  expect(sliceView(lines, 4, 3)).toEqual(['a']);
  expect(sliceView(lines, 99, 3)).toEqual([]);
  expect(sliceView(lines, 0, 99)).toEqual(lines);
});

test('wheelBurst:同 chunk 连续≥2 个同向方向键=滚轮;单个/混向/其它不算', () => {
  expect(wheelBurst('\x1b[A\x1b[A\x1b[A')).toEqual({ dir: 'up', n: 3 });
  expect(wheelBurst('\x1b[B\x1b[B')).toEqual({ dir: 'down', n: 2 });
  expect(wheelBurst('\x1bOA\x1bOA')).toEqual({ dir: 'up', n: 2 }); // SS3 编码也认
  expect(wheelBurst('\x1b[A')).toBeNull();          // 键盘单按
  expect(wheelBurst('\x1b[A\x1b[B')).toBeNull();    // 混向不是滚轮
  expect(wheelBurst('abc')).toBeNull();
  expect(wheelBurst('')).toBeNull();
});

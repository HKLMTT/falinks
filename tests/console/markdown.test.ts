import { expect, test } from 'vitest';
import { renderMarkdown } from '../../src/console/markdown.js';

// 取某行的纯文本(拼接片段)
const flat = (line: { text: string }[]) => line.map((s) => s.text).join('');

test('行内粗体:** ** → bold 片段,其余纯文本', () => {
  const [line] = renderMarkdown('前 **粗** 后');
  expect(flat(line)).toBe('前 粗 后');
  const boldSeg = line.find((s) => s.text === '粗');
  expect(boldSeg?.bold).toBe(true);
  expect(line.find((s) => s.text === '前 ')?.bold).toBeUndefined();
});

test('斜体 / 行内码 / 删除线 各自的样式', () => {
  expect(renderMarkdown('*斜*')[0].find((s) => s.text === '斜')?.italic).toBe(true);
  expect(renderMarkdown('`代码`')[0].find((s) => s.text === '代码')?.dim).toBe(true);
  expect(renderMarkdown('~~删~~')[0].find((s) => s.text === '删')?.strikethrough).toBe(true);
});

test('标题:去掉 # 且整行 bold', () => {
  const [line] = renderMarkdown('## 标题文字');
  expect(flat(line)).toBe('标题文字');
  expect(line.every((s) => s.bold)).toBe(true);
});

test('无序/有序列表:加对齐标记前缀', () => {
  expect(flat(renderMarkdown('- 项一')[0])).toBe('• 项一');
  expect(flat(renderMarkdown('1. 甲')[0])).toBe('1. 甲');
  expect(flat(renderMarkdown('3) 乙')[0])).toBe('3. 乙');
});

test('列表项里的行内样式照常生效', () => {
  const [line] = renderMarkdown('- 有 **粗** 的项');
  expect(flat(line)).toBe('• 有 粗 的项');
  expect(line.find((s) => s.text === '粗')?.bold).toBe(true);
});

test('围栏代码块:逐行 dim、不做行内解析(** 不被当粗体)', () => {
  const lines = renderMarkdown('```js\nconst x = `a` + **b**;\n```');
  // 3 行:```js / 代码 / ```
  expect(lines.length).toBe(3);
  expect(lines[1].length).toBe(1);
  expect(lines[1][0].dim).toBe(true);
  expect(lines[1][0].text).toBe('const x = `a` + **b**;'); // 原样,未被解析
});

test('引用 + 分割线', () => {
  expect(flat(renderMarkdown('> 引用')[0])).toBe('▌ 引用');
  expect(renderMarkdown('---')[0][0].text).toBe('────────');
});

test('去掉首尾空行,保留中间空行', () => {
  const lines = renderMarkdown('\n\nA\n\nB\n\n');
  expect(lines.map(flat)).toEqual(['A', '', 'B']);
});

test('纯文本原样(含中文)、不误伤', () => {
  expect(flat(renderMarkdown('MSG-01 普通一行')[0])).toBe('MSG-01 普通一行');
});

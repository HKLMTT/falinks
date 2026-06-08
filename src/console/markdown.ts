import { Lexer } from 'marked';

/**
 * 一段文本被渲染成「带样式的片段」(对齐 Claude Code 的做法:marked 解析 → 样式片段 → Ink <Text>)。
 * 片段不含 ANSI,样式交给 Ink 组件,Ink 自己算宽度/换行,不会被裸 ANSI 码搞乱排版。
 */
export interface Seg {
  text: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
}
type Style = Omit<Seg, 'text'>;

/** 递归把 marked 行内 token 摊平成带累积样式的片段。 */
function walk(tokens: any[], style: Style, out: Seg[]): void {
  for (const tk of tokens) {
    switch (tk.type) {
      case 'strong': walk(tk.tokens ?? [{ type: 'text', text: tk.text }], { ...style, bold: true }, out); break;
      case 'em': walk(tk.tokens ?? [{ type: 'text', text: tk.text }], { ...style, italic: true }, out); break;
      case 'del': walk(tk.tokens ?? [{ type: 'text', text: tk.text }], { ...style, strikethrough: true }, out); break;
      case 'link': walk(tk.tokens ?? [{ type: 'text', text: tk.text }], { ...style, underline: true }, out); break;
      case 'codespan': out.push({ text: tk.text, ...style, dim: true }); break;
      case 'br': break;
      default: if (tk.text) out.push({ text: tk.text, ...style }); // text / escape / 其它当纯文本
    }
  }
}

/** 行内 markdown → 片段(粗/斜/行内码/删除/链接);解析失败或空则原样返回一段。 */
function inline(text: string): Seg[] {
  if (text === '') return [{ text: '' }];
  const out: Seg[] = [];
  try { walk(Lexer.lexInline(text), {}, out); } catch { /* 退化为纯文本 */ }
  return out.length ? out : [{ text }];
}

const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^(\s*)>\s?(.*)$/;
const UL = /^(\s*)[-*+]\s+(.*)$/;
const OL = /^(\s*)(\d+)[.)]\s+(.*)$/;

/**
 * 把消息正文渲染成「逐行的样式片段」。块级按源码行处理(标题/列表/引用/分割线/围栏代码),
 * 行内交给 marked —— 这样保留了源码行结构,与折叠(取前 N 行)/展开/回看的按行计数无缝衔接。
 * 围栏代码块(``` 之间)逐行 dim 原样显示,不做行内解析。去掉首尾空行。
 */
export function renderMarkdown(body: string): Seg[][] {
  const lines: Seg[][] = [];
  let inFence = false;
  for (const raw of String(body).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*```/.test(line)) { inFence = !inFence; lines.push([{ text: line, dim: true }]); continue; }
    if (inFence) { lines.push([{ text: line || ' ', dim: true }]); continue; }
    let m: RegExpExecArray | null;
    if ((m = HEADING.exec(line))) { lines.push(inline(m[2]).map((s) => ({ ...s, bold: true }))); continue; }
    if (HR.test(line)) { lines.push([{ text: '────────', dim: true }]); continue; }
    if ((m = QUOTE.exec(line))) { lines.push([{ text: `${m[1]}▌ `, dim: true }, ...inline(m[2]).map((s) => ({ ...s, dim: true }))]); continue; }
    if ((m = UL.exec(line))) { lines.push([{ text: `${m[1]}• ` }, ...inline(m[2])]); continue; }
    if ((m = OL.exec(line))) { lines.push([{ text: `${m[1]}${m[2]}. ` }, ...inline(m[3])]); continue; }
    lines.push(inline(line));
  }
  const blank = (l: Seg[]) => l.length === 1 && l[0].text === '';
  while (lines.length && blank(lines[0])) lines.shift();
  while (lines.length && blank(lines[lines.length - 1])) lines.pop();
  return lines;
}

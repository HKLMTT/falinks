export interface LogMsg { id: string; from: string; to: string; body: string; ts: number; queued?: boolean }

/** 把 log 中 id 未见过的消息按顺序追加到 committed(已提交项引用不变);无新增则返回原数组。
 *  同一批 log 内重复 id 也去重(防 id 撞号时同 key 渲染/漏渲染),保留首次出现。 */
export function appendCommitted<T extends { id: string }>(committed: T[], log: T[]): T[] {
  const seen = new Set(committed.map((m) => m.id));
  const fresh: T[] = [];
  for (const m of log) if (!seen.has(m.id)) { seen.add(m.id); fresh.push(m); }
  if (fresh.length === 0) return committed;
  return [...committed, ...fresh];
}

/** 仍在对方 inbox 排队(queued)的消息按目标聚合计数,保首次出现顺序。多条排队不能只显示一个目标——条数要可见。 */
export function pendingCounts(log: LogMsg[]): { to: string; n: number }[] {
  const out: { to: string; n: number }[] = [];
  for (const m of log) {
    if (!m.queued) continue;
    const e = out.find((x) => x.to === m.to);
    if (e) e.n++;
    else out.push({ to: m.to, n: 1 });
  }
  return out;
}

/** 带样式+颜色的渲染片段(markdown Seg 的超集:头部行需要名字颜色)。 */
export interface StyledSeg {
  text: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  color?: string;
}

/** 一个码点的终端显示列宽:CJK/全角/emoji=2,其余=1。
 *  与 Ink 的 string-width 足够接近;个别误差由渲染侧 wrap="truncate-end" 兜底,不会破排版。 */
function cpWidth(cp: number): number {
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK 部首/汉字/假名等
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul 音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容形式
    (cp >= 0xff00 && cp <= 0xff60) || // 全角
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK 扩展
  ) return 2;
  return 1;
}

/** 字符串的终端显示列宽。 */
export function dispWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += cpWidth(ch.codePointAt(0)!);
  return w;
}

/**
 * 把一行样式片段按显示列宽折成多行(贪婪逐码点,CJK=2 列),样式跟随片段不丢。
 * 自己折行(而不是交给 Ink wrap)是视口滚动的前提:滚动按"屏幕行"计数,必须 1 逻辑行 = 1 屏幕行。
 * width<=0 不折;空行返回 [[]](占一屏幕行)。
 */
export function wrapSegs(segs: StyledSeg[], width: number): StyledSeg[][] {
  if (width <= 0) return [segs];
  const rows: StyledSeg[][] = [];
  let row: StyledSeg[] = [];
  let used = 0;
  for (const seg of segs) {
    let buf = '';
    for (const ch of seg.text) {
      const w = cpWidth(ch.codePointAt(0)!);
      if (used + w > width && used > 0) {
        if (buf) row.push({ ...seg, text: buf });
        rows.push(row);
        row = []; used = 0; buf = '';
      }
      buf += ch; used += w;
    }
    if (buf) row.push({ ...seg, text: buf });
  }
  rows.push(row);
  return rows;
}

/** 回看偏移夹紧:0=实时贴底;最大不超过"总行数-视口行数"(内容不足一屏时恒为 0)。 */
export function clampOffset(offset: number, total: number, viewH: number): number {
  return Math.max(0, Math.min(offset, total - Math.max(1, viewH)));
}

/** 取视口切片:从底部往上偏移 offset 行,向上取 count 行(不足则有多少取多少)。 */
export function sliceView<T>(lines: T[], offset: number, count: number): T[] {
  const end = Math.max(0, lines.length - offset);
  return lines.slice(Math.max(0, end - count), end);
}

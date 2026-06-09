/**
 * 把一条消息正文整理成可读的多行：保留换行、去首尾空行、逐行去尾部空白，按 maxLines 截断。
 * 宽度折行交给 Ink（<Text wrap="wrap">），不在此处理。
 */
export function formatBody(body: string, maxLines: number): { lines: string[]; truncated: number } {
  let lines = String(body).split('\n').map((l) => l.replace(/\s+$/, ''));
  // 去首尾空行
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length <= maxLines) return { lines, truncated: 0 };
  return { lines: lines.slice(0, maxLines), truncated: lines.length - maxLines };
}

/** 给发言人配色的调色板：尽量多且互相区分（名字按花名册顺序取色，基本不重复）。 */
export const NAME_COLORS = [
  'cyan', 'green', 'yellow', 'magenta', 'blue', 'red',
  'cyanBright', 'greenBright', 'yellowBright', 'magentaBright', 'blueBright', 'redBright',
  '#ff8800', '#00d7af', '#af87ff', '#ff5fd7', '#5fd7ff', '#d7ff5f',
  '#ffaf5f', '#5fffaf',
];
export function nameColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

/**
 * pane 背景染色调色板:与 NAME_COLORS **逐位对齐**的深色低饱和 hex(暗色主题下不压正文)。
 * 同一 roster 下标 → 控制台名字用 NAME_COLORS[i]、对应 pane 底色用 PANE_BG_COLORS[i] → 同色相,
 * 做到"花名册里 lead 是绿色 ↔ lead 的 pane 是深绿底"。
 */
export const PANE_BG_COLORS = [
  '#0a2424', '#0a2410', '#262207', '#260a22', '#0a1430', '#280c0c',
  '#0c2e2e', '#0c2e14', '#2e2a08', '#2e0c2a', '#0c193c', '#300e0e',
  '#301c08', '#082a24', '#1e1830', '#2e1228', '#0e2230', '#222e10',
  '#2e2210', '#0e2e20',
];

/** 按 roster 下标取 pane 底色(越界回绕)。 */
export function paneBgColor(index: number): string {
  return PANE_BG_COLORS[((index % PANE_BG_COLORS.length) + PANE_BG_COLORS.length) % PANE_BG_COLORS.length];
}

/** `#rrggbb`(或无 # 前缀)→ AppleScript 色值三通道 0..65535(各通道 *257)。 */
export function hexToAppleRGB(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r * 257, g * 257, b * 257];
}

/** epoch 毫秒 → 本地 HH:MM:SS。 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 一条消息在消息行里要不要显示投递徽标、显示哪个。
 * 只给"投给真实员工"的消息显示：虚拟成员(boss)只记日志不投递、不在册的目标都返回 none。
 * queued = 该消息此刻仍在目标 inbox 里（由 /admin/log 的 queued 字段给出）。
 */
export function deliveryState(
  to: string,
  queued: boolean,
  roster: { name: string; virtual?: boolean }[],
): 'queued' | 'delivered' | 'none' {
  const target = roster.find((a) => a.name === to);
  if (!target || target.virtual) return 'none';
  return queued ? 'queued' : 'delivered';
}

/** 花名册状态点动画帧(braille spinner，在忙时逐帧滚动）。 */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * 花名册前的状态点:虚拟成员(boss)用小圆点;在忙 / 启动中用 spinner 当前帧（动起来，
 * 一眼看出谁在干活）;其余(空闲/挂掉)用静态实心点。颜色仍由 status 决定，这里只管字形。
 */
export function statusGlyph(status: string, virtual: boolean, frame: number): string {
  if (virtual) return '·';
  if (status === 'busy' || status === 'launching') return SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
  return '●';
}

/**
 * 回看选中位移。selBack = 选中条距最新多少条（0=最新），null = 实时态（不在回看）。
 * dir='older'(Ctrl+↑)：往更早走，封顶在最早一条；从实时态进入则选中最新(0)。
 * dir='newer'(Ctrl+↓)：往更新走；越过最新（selBack<0）→ 返回 null = 退出回看。
 */
export function moveSel(selBack: number | null, total: number, dir: 'older' | 'newer'): number | null {
  if (total <= 0) return null;
  if (dir === 'older') return selBack === null ? 0 : Math.min(total - 1, selBack + 1);
  if (selBack === null) return null;
  return selBack - 1 < 0 ? null : selBack - 1;
}

/** 让选中条落在视口内的渲染窗口 [start,end)：尽量居中，触顶/触底夹紧。 */
export function windowRange(selIdx: number, total: number, size: number): { start: number; end: number } {
  if (total <= size) return { start: 0, end: total };
  const start = Math.min(Math.max(0, selIdx - Math.floor(size / 2)), total - size);
  return { start, end: start + size };
}

/**
 * 回看渲染窗口 [start,end)——选中条作为**窗口最后一条**(end=selIdx+1),向上(更早)按真实行高填到 budget。
 * 配合消息区**贴底渲染(justifyContent:flex-end)**:选中条紧挨输入框、必然完整可见;窗口一旦超高,
 * Ink 的 overflow:hidden 裁掉的是**顶部**(更早的上下文)——绝不会动选中条及其下方。
 * 这样彻底回避了"按条数取窗 / 行高估算不准(中文折行)导致选中条被裁底"的老问题(不依赖精确行高,
 * heightAt 只决定向上填几条;视觉正确性由 flex-end + 裁顶兜底)。
 *
 * 语义:看不到比选中条更新的消息(向后翻历史的 pager 行为)。heightAt(i)=内容行数(不含条间距,+1/相邻)。
 */
export function windowByHeight(
  selIdx: number,
  total: number,
  budget: number,
  heightAt: (i: number) => number,
): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  selIdx = Math.max(0, Math.min(total - 1, selIdx));
  const end = selIdx + 1; // 选中条即末条
  let start = selIdx;
  let used = heightAt(selIdx);
  while (start > 0) {
    const cost = heightAt(start - 1) + 1; // +1 = 条间距(marginTop)
    if (used + cost > budget) break;
    used += cost;
    start--;
  }
  return { start, end };
}

/**
 * 回看消息区可用行数(估算,偏保守防溢出):扣掉 logo(4) + 花名册(2+roster) + 消息标题(2) + 输入区(~5)。
 * 故意比 visibleCount 的 chrome 更大一点:宁可少显示一条,也别让窗口溢出把选中条裁掉。
 */
export function browseRowBudget(rows: number, rosterLen: number): number {
  const chrome = 13 + rosterLen;
  return Math.max(3, rows - chrome);
}

/** 终端显示宽度估算:CJK/全角字符算 2 列,其余算 1 列(给折行估算用,够准即可)。 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||   // Hangul Jamo
      (c >= 0x2e80 && c <= 0x303e) ||   // CJK 部首/符号
      (c >= 0x3041 && c <= 0x33ff) ||   // 假名/CJK 符号
      (c >= 0x3400 && c <= 0x4dbf) ||   // CJK 扩展 A
      (c >= 0x4e00 && c <= 0x9fff) ||   // CJK 统一表意
      (c >= 0xa000 && c <= 0xa4cf) ||   // 彝文
      (c >= 0xac00 && c <= 0xd7a3) ||   // 谚文音节
      (c >= 0xf900 && c <= 0xfaff) ||   // CJK 兼容
      (c >= 0xfe30 && c <= 0xfe4f) ||   // CJK 兼容形式
      (c >= 0xff00 && c <= 0xff60) ||   // 全角 ASCII
      (c >= 0xffe0 && c <= 0xffe6) ||   // 全角符号
      (c >= 0x1f300 && c <= 0x1faff) || // 表情/符号
      (c >= 0x20000 && c <= 0x3fffd);   // CJK 扩展 B+
    w += wide ? 2 : 1;
  }
  return w;
}

/** 一行文本按列宽折成几行(至少 1)。列宽异常(<=0)兜底为 1。 */
export function wrapRows(width: number, cols: number): number {
  if (cols <= 0) return 1;
  return Math.max(1, Math.ceil(width / cols));
}

/**
 * 回看渲染窗口 [start,end)——光标在视口内移动、撞到上/下边缘才滚动视口(符合滚动操作习惯)。
 * windowByHeight 把选中条钉死在底部、每次滚动都整体平移一条;这里改为带"滚动锚点 prevStart"的视口:
 * - 选中条仍在视口内 → 视口不动(prevStart 不变),只是光标(❯)在可见消息间上下移动;
 * - 选中条越过视口顶 → 视口上滚,让它落到顶部;
 * - 选中条跌出视口底(或大跳/刚进入回看)→ 选中条贴底,向上按行高填满视口(复用 windowByHeight)。
 * 与贴底渲染(flex-end)配合;heightAt 行高估准(含折行)时窗口贴合 budget、不裁。幂等(同 selIdx 再算结果不变)。
 */
export function scrollWindow(
  prevStart: number,
  selIdx: number,
  total: number,
  budget: number,
  heightAt: (i: number) => number,
): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  selIdx = Math.max(0, Math.min(total - 1, selIdx));
  let start = Math.max(0, Math.min(prevStart, selIdx)); // 选中条不能在视口顶之上
  // 从 start 向下按行高填到 budget,得到 end
  let used = heightAt(start);
  let end = start + 1;
  while (end < total) {
    const cost = heightAt(end) + 1; // +1 条间距
    if (used + cost > budget) break;
    used += cost;
    end++;
  }
  if (end <= selIdx) {
    // 选中条在视口底之下 → 贴底重排(选中条作末条,向上填)
    return windowByHeight(selIdx, total, budget, heightAt);
  }
  // 选中条可见;若下方填不满 budget(到历史末尾)则向上补满,保持视口饱满、贴底好看
  while (start > 0) {
    const cost = heightAt(start - 1) + 1;
    if (used + cost > budget) break;
    used += cost;
    start--;
  }
  return { start, end };
}

/**
 * 消息区可见条数:随终端高度自适应,不再固定 6 条留大片空白。
 * 粗估每条折叠约占 4 行(1 头 + ≤3 正文/边距);扣掉固定区(logo/花名册/标题/输入)。
 * 夹紧到 [6, 60]:太矮保底 6、太高封顶 60(多出的由消息区 overflow 裁掉)。
 */
export function visibleCount(rows: number, rosterLen: number): number {
  const chrome = 8 + rosterLen;
  return Math.min(60, Math.max(6, Math.floor((rows - chrome) / 4)));
}

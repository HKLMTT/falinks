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
 * 消息区可见条数:随终端高度自适应,不再固定 6 条留大片空白。
 * 粗估每条折叠约占 4 行(1 头 + ≤3 正文/边距);扣掉固定区(logo/花名册/标题/输入)。
 * 夹紧到 [6, 60]:太矮保底 6、太高封顶 60(多出的由消息区 overflow 裁掉)。
 */
export function visibleCount(rows: number, rosterLen: number): number {
  const chrome = 8 + rosterLen;
  return Math.min(60, Math.max(6, Math.floor((rows - chrome) / 4)));
}

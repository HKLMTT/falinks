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

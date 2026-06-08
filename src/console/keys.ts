/**
 * 终端按键解码：把 stdin 的原始字节串解成规范化的按键事件。
 * 同时认 kitty 渐进增强(CSI-u,如 Shift+Enter=`\x1b[13;2u`)与传统编码(`\r`、`\x1b[A`、0x03…)。
 * 开了 kitty 协议后,被修饰的键(Shift+Enter、Ctrl+C/V…)走 CSI-u,普通文字仍是原始 UTF-8。
 */

/** 启用 kitty 键盘协议(flag 1：消歧)；退出前发 KITTY_POP 还原。 */
export const KITTY_PUSH = '\x1b[>1u';
export const KITTY_POP = '\x1b[<u';

export type KeyEvent =
  | { type: 'text'; text: string }
  | { type: 'enter' }
  | { type: 'shift-enter' }
  | { type: 'backspace' }
  | { type: 'tab' }
  | { type: 'esc' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'pageup' }   // PageUp：回看历史(选更早一条)
  | { type: 'pagedown' } // PageDown：回看历史(选更新一条 / 退出)
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'ctrl'; key: string } // ctrl+<小写字母>，如 c/v
  | { type: 'unknown'; raw: string };

const CSI_U = /^\x1b\[(\d+)(?:;(\d+))?u$/;

export function decodeKey(s: string): KeyEvent {
  // kitty CSI-u: ESC [ code ; mods u   （mods = 1 + 位掩码：1=Shift,2=Alt,4=Ctrl）
  const m = CSI_U.exec(s);
  if (m) {
    const code = Number(m[1]);
    const mods = m[2] ? Number(m[2]) - 1 : 0;
    const shift = (mods & 1) !== 0;
    const ctrl = (mods & 4) !== 0;
    if (code === 13) return shift ? { type: 'shift-enter' } : { type: 'enter' };
    if (code === 27) return { type: 'esc' };
    if (code === 9) return { type: 'tab' };
    if (code === 127 || code === 8) return { type: 'backspace' };
    if (ctrl && code >= 97 && code <= 122) return { type: 'ctrl', key: String.fromCharCode(code) };
    if (ctrl && code >= 65 && code <= 90) return { type: 'ctrl', key: String.fromCharCode(code + 32) };
    return { type: 'text', text: String.fromCodePoint(code) };
  }

  // 传统编码
  if (s === '\r' || s === '\n') return { type: 'enter' };
  if (s === '\t') return { type: 'tab' };
  if (s === '\x7f' || s === '\x08') return { type: 'backspace' };
  if (s === '\x1b[A' || s === '\x1bOA') return { type: 'up' };
  if (s === '\x1b[B' || s === '\x1bOB') return { type: 'down' };
  if (s === '\x1b[C' || s === '\x1bOC') return { type: 'right' };
  if (s === '\x1b[D' || s === '\x1bOD') return { type: 'left' };
  if (s === '\x1b[H' || s === '\x1bOH' || s === '\x1b[1~' || s === '\x1b[7~') return { type: 'home' };
  if (s === '\x1b[F' || s === '\x1bOF' || s === '\x1b[4~' || s === '\x1b[8~') return { type: 'end' };
  if (s === '\x1b[5~') return { type: 'pageup' };
  if (s === '\x1b[6~') return { type: 'pagedown' };
  if (s === '\x1b') return { type: 'esc' };

  // 单字节 Ctrl+字母(传统)：0x01..0x1a → ctrl+a..ctrl+z（排除已处理的 \r=0x0d、\t=0x09、\x08）
  if (s.length === 1) {
    const c = s.charCodeAt(0);
    if (c >= 1 && c <= 26 && c !== 13 && c !== 9 && c !== 8) {
      return { type: 'ctrl', key: String.fromCharCode(c + 96) };
    }
  }

  // 非转义起头的可见/文字内容(含中文、粘贴) → 文字
  if (!s.startsWith('\x1b') && s.length > 0) return { type: 'text', text: s };

  return { type: 'unknown', raw: s };
}

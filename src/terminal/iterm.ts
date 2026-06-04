import { spawn } from 'node:child_process';
import { escapeAppleScript } from './applescript.js';
import type { LaunchOpts, TerminalDriver } from './driver.js';

/** POSIX 单引号转义：把字符串安全地用于 shell 命令中的一个参数。 */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 执行一段 AppleScript（经 osascript stdin），返回 trim 后的 stdout。 */
function osascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('osascript', ['-']);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `osascript exit ${code}`)),
    );
    p.stdin.write(script);
    p.stdin.end();
  });
}

/** 生成"遍历 windows→tabs→sessions 匹配 id 后执行 action"的脚本片段。 */
function onSession(sessionId: string, action: string): string {
  return `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (id of s) is "${sessionId}" then
          ${action}
        end if
      end repeat
    end repeat
  end repeat
  return "NOT_FOUND"
end tell`;
}

export class ITerm2Driver implements TerminalDriver {
  /** 两步提交之间的 settle 延时（ms）：让 TUI 稳定，避免回车被吞。 */
  static SUBMIT_SETTLE_MS = 600;

  async launch(opts: LaunchOpts): Promise<string> {
    // 注：opts.command 视为受信任（来自本机配置，可含 flags），故不做 shQuote；
    // cwd 是路径、需 shQuote 防空格/引号。若 Plan 1B 起 command 改为动态来源，需同等处理。
    const cmd = escapeAppleScript(`cd ${shQuote(opts.cwd)} && ${opts.command}`);
    const script = `tell application "iTerm2"
  set w to (create window with default profile)
  tell current session of w
    write text "${cmd}"
    return id
  end tell
end tell`;
    const id = await osascript(script);
    if (!id || id === 'NOT_FOUND') throw new Error('launch failed: no session id');
    return id;
  }

  async inject(sessionId: string, text: string, submit: boolean): Promise<void> {
    // 单次 write-text+newline 对 Claude TUI 的"提交"不可靠（初始化/刚结束回合时
    // 末尾 CR 会被吃掉，Phase 1B 里程碑实测）。可靠做法：先写正文（不提交，LF=插入换行），
    // settle 后单独发一个回车提交。submit=false 时只写正文。
    await this.write(sessionId, text, false);
    if (submit) {
      await new Promise((r) => setTimeout(r, ITerm2Driver.SUBMIT_SETTLE_MS));
      await this.write(sessionId, '', true);
    }
  }

  /** 单次 `write text`：往匹配 session 写文本，submit=true 时末尾附回车提交。 */
  private async write(sessionId: string, text: string, submit: boolean): Promise<void> {
    const nl = submit ? 'YES' : 'NO';
    const action = `tell s to write text "${escapeAppleScript(text)}" newline ${nl}
          return "OK"`;
    const r = await osascript(onSession(sessionId, action));
    if (r !== 'OK') throw new Error(`inject: session not found: ${sessionId}`);
  }

  async readScreen(sessionId: string): Promise<string> {
    const action = `return text of s`;
    const r = await osascript(onSession(sessionId, action));
    if (r === 'NOT_FOUND') throw new Error(`readScreen: session not found: ${sessionId}`);
    return r;
  }

  async close(sessionId: string): Promise<void> {
    const action = `close w
          return "OK"`;
    await osascript(onSession(sessionId, action));
  }

  async splitFrom(anchorSessionId: string, direction: 'vertical' | 'horizontal', opts: LaunchOpts): Promise<string> {
    const verb = direction === 'vertical' ? 'split vertically' : 'split horizontally';
    const cmd = escapeAppleScript(`cd ${shQuote(opts.cwd)} && ${opts.command}`);
    const script = `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (id of s) is "${anchorSessionId}" then
          tell s
            set newp to (${verb} with default profile)
          end tell
          tell newp to write text "${cmd}"
          return (id of newp)
        end if
      end repeat
    end repeat
  end repeat
  return "NOT_FOUND"
end tell`;
    const id = await osascript(script);
    if (!id || id === 'NOT_FOUND') throw new Error(`splitFrom: anchor not found: ${anchorSessionId}`);
    return id;
  }

  async closePane(sessionId: string): Promise<void> {
    const action = `close s
          return "OK"`;
    await osascript(onSession(sessionId, action));
  }

  async paneExists(sessionId: string): Promise<boolean> {
    const r = await osascript(onSession(sessionId, 'return "OK"'));
    return r === 'OK';
  }
}

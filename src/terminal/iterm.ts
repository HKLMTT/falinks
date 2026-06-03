import { spawn } from 'node:child_process';
import { escapeAppleScript } from './applescript.js';
import type { LaunchOpts, TerminalDriver } from './driver.js';

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
  async launch(opts: LaunchOpts): Promise<string> {
    const cmd = escapeAppleScript(`cd ${opts.cwd} && ${opts.command}`);
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
}

import { spawn } from 'node:child_process';
import { escapeAppleScript } from './applescript.js';
import { submitWithVerify } from './submit.js';
import { hexToAppleRGB } from '../console/log-format.js';
import type { LaunchOpts, TerminalDriver } from './driver.js';

/** POSIX 单引号转义：把字符串安全地用于 shell 命令中的一个参数。 */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 执行一段 AppleScript(经 osascript stdin),返回 trim 后的 stdout。
 *  默认 15s 超时强杀:iTerm 主线程拥堵时挂死的调用不再永久占位(调用方按"探测失败"兜底)。
 *  timeoutMs 可由调用方按需延长(如批量 pollPanes 随 pane 数伸缩)。 */
const OSASCRIPT_TIMEOUT_MS = 15_000;
function osascript(script: string, timeoutMs = OSASCRIPT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('osascript', ['-']);
    let out = '';
    let err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('osascript timeout')); }, timeoutMs);
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `osascript exit ${code}`));
    });
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
  /** 发回车后等多久再读屏验证是否真提交。 */
  static SUBMIT_VERIFY_MS = 400;
  /** 提交回车被吞时的最大重试次数(含首次)。 */
  static SUBMIT_MAX_ATTEMPTS = 3;

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
    // 单次 write-text+newline 对 Claude TUI 的"提交"不可靠（初始化/刚结束回合/大段粘贴时
    // 末尾 CR 会被吞掉）。可靠做法：先写正文（不提交，LF=插入换行），settle 后单独发回车提交，
    // 并读屏验证正文是否真离开了输入框——被吞则重发(最多 SUBMIT_MAX_ATTEMPTS 次)。submit=false 时只写正文。
    await this.write(sessionId, text, false);
    if (!submit) return;
    await submitWithVerify({
      enter: () => this.write(sessionId, '', true),
      readScreen: () => this.readScreen(sessionId),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      body: text,
      settleMs: ITerm2Driver.SUBMIT_SETTLE_MS,
      verifyMs: ITerm2Driver.SUBMIT_VERIFY_MS,
      maxAttempts: ITerm2Driver.SUBMIT_MAX_ATTEMPTS,
    });
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

  async setName(sessionId: string, name: string): Promise<void> {
    const action = `tell s to set name to "${escapeAppleScript(name)}"
          return "OK"`;
    await osascript(onSession(sessionId, action));
  }

  async setBackgroundColor(sessionId: string, hex: string): Promise<void> {
    const [r, g, b] = hexToAppleRGB(hex);
    const action = `tell s to set background color to {${r}, ${g}, ${b}}
          return "OK"`;
    await osascript(onSession(sessionId, action));
  }

  async isProcessing(sessionId: string): Promise<boolean> {
    const r = await osascript(onSession(sessionId, 'return (is processing of s) as string'));
    return r.trim() === 'true';
  }

  async pollPanes(targets: { sessionId: string; pinName?: string }[]): Promise<Map<string, { processing: boolean }>> {
    if (targets.length === 0) return new Map();
    // 超时随目标数伸缩(15s + 100ms/目标,上限 60s):pane 极多时批量脚本本身变慢,
    // 固定 15s 会让每轮都超时 → 永久状态冻结;重入护栏已防叠加,等久一点没有代价。
    const timeoutMs = Math.min(60_000, 15_000 + targets.length * 100);
    const out = await osascript(buildPollScript(targets), timeoutMs);
    const m = parsePollOutput(out);
    // 护栏:有输出却一条都解析不出 = 脚本输出格式坏了(如 AppleScript 常量被遮蔽),
    // 宁可整轮失败(调用方跳过维持现状)也不能返回空 Map 把全员误判成 pane 消失。
    if (out.trim() !== '' && m.size === 0) throw new Error(`pollPanes: unparseable output: ${out.slice(0, 80)}`);
    return m;
  }
}

/** 生成批量轮询脚本:单次遍历全部 sessions,对命中的目标收集 is processing(一行 `id<TAB>bool`),
 *  带 pinName 的顺带 set name(写进同一脚本,不另起调用)。导出供单测。 */
export function buildPollScript(targets: { sessionId: string; pinName?: string }[]): string {
  const branches = targets
    .map((t) => {
      const pin = t.pinName !== undefined ? `\n          set name of s to "${escapeAppleScript(t.pinName)}"` : '';
      return `        if sid is "${t.sessionId}" then${pin}
          set out to out & sid & tabchar & ((is processing of s) as string) & linefeed
        end if`;
    })
    .join('\n');
  return `set tabchar to tab
tell application "iTerm2"
  set out to ""
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        set sid to (id of s)
${branches}
      end repeat
    end repeat
  end repeat
  return out
end tell`;
}

/** 解析批量轮询输出:每行 `id<TAB>true|false`;不合格式的行忽略(容错)。 */
export function parsePollOutput(out: string): Map<string, { processing: boolean }> {
  const m = new Map<string, { processing: boolean }>();
  for (const line of out.split('\n')) {
    const i = line.indexOf('\t');
    if (i <= 0) continue;
    const flag = line.slice(i + 1).trim();
    if (flag !== 'true' && flag !== 'false') continue;
    m.set(line.slice(0, i), { processing: flag === 'true' });
  }
  return m;
}

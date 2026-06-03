export interface LaunchOpts {
  cwd: string;
  command: string; // 例如 "claude" 或 "codex"
}

export interface TerminalDriver {
  /** 新建终端窗口、cd 到 cwd 并运行 command；返回稳定 session 句柄。 */
  launch(opts: LaunchOpts): Promise<string>;
  /** 把 text 注入 session；submit=true 时末尾提交（回车）。 */
  inject(sessionId: string, text: string, submit: boolean): Promise<void>;
  /** 读取该 session 当前可见屏幕文本。 */
  readScreen(sessionId: string): Promise<string>;
  /** 关闭该 session 所在窗口。 */
  close(sessionId: string): Promise<void>;
}

/** 测试替身：记录所有 inject、可设定 readScreen 返回值。 */
export class FakeDriver implements TerminalDriver {
  windows = new Map<string, LaunchOpts>();
  injections: { sessionId: string; text: string; submit: boolean }[] = [];
  private screens = new Map<string, string>();
  private counter = 0;

  async launch(opts: LaunchOpts): Promise<string> {
    const sid = `fake-session-${++this.counter}`;
    this.windows.set(sid, opts);
    return sid;
  }

  async inject(sessionId: string, text: string, submit: boolean): Promise<void> {
    if (!this.windows.has(sessionId)) throw new Error(`unknown session: ${sessionId}`);
    this.injections.push({ sessionId, text, submit });
  }

  async readScreen(sessionId: string): Promise<string> {
    if (!this.windows.has(sessionId)) throw new Error(`unknown session: ${sessionId}`);
    return this.screens.get(sessionId) ?? '';
  }

  async close(sessionId: string): Promise<void> {
    this.windows.delete(sessionId);
  }

  setScreen(sessionId: string, content: string): void {
    this.screens.set(sessionId, content);
  }
}

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
  /** 从 anchor pane 切出新 pane（vertical=左右, horizontal=上下），在其中起 command，返回新 session id。 */
  splitFrom(anchorSessionId: string, direction: 'vertical' | 'horizontal', opts: LaunchOpts): Promise<string>;
  /** 关闭单个 pane（不关整窗）。 */
  closePane(sessionId: string): Promise<void>;
  /** 该 session/pane 当前是否还存在（用于检测员工窗口被关）。 */
  paneExists(sessionId: string): Promise<boolean>;
  /** 设置 pane 的名字（标题）。 */
  setName(sessionId: string, name: string): Promise<void>;
  /** 设置 pane 背景色（hex `#rrggbb`）——按角色染色,CLI 改不掉(直接作用于 session)。 */
  setBackgroundColor(sessionId: string, hex: string): Promise<void>;
  /** pane 是否“正在处理”——iTerm2 原生信号:最近约 2 秒内收到过输出(干活的 CLI 持续刷 spinner=持续有输出)。 */
  isProcessing(sessionId: string): Promise<boolean>;
  /** 批量轮询:单次遍历采集每个目标 pane 的存在性与 is processing;带 pinName 的顺带钉标题。
   *  返回 Map,**缺席的 id = pane 已不存在**。一办公室一轮一次调用,替代逐 pane 的 paneExists/isProcessing/setName 风暴。 */
  pollPanes(targets: { sessionId: string; pinName?: string }[]): Promise<Map<string, { processing: boolean }>>;
}

/** 测试替身：记录所有 inject、可设定 readScreen 返回值。 */
export class FakeDriver implements TerminalDriver {
  windows = new Map<string, LaunchOpts>();
  injections: { sessionId: string; text: string; submit: boolean }[] = [];
  splits: { anchor: string; direction: 'vertical' | 'horizontal'; sessionId: string }[] = [];
  names = new Map<string, string>();
  backgrounds = new Map<string, string>();
  processing = new Map<string, boolean>();
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

  async splitFrom(anchorSessionId: string, direction: 'vertical' | 'horizontal', opts: LaunchOpts): Promise<string> {
    if (!this.windows.has(anchorSessionId)) throw new Error(`unknown session: ${anchorSessionId}`);
    const sid = `fake-session-${++this.counter}`;
    this.windows.set(sid, opts);
    this.splits.push({ anchor: anchorSessionId, direction, sessionId: sid });
    return sid;
  }

  async closePane(sessionId: string): Promise<void> {
    this.windows.delete(sessionId);
  }

  async paneExists(sessionId: string): Promise<boolean> {
    return this.windows.has(sessionId);
  }

  async setName(sessionId: string, name: string): Promise<void> {
    this.names.set(sessionId, name);
  }

  async setBackgroundColor(sessionId: string, hex: string): Promise<void> {
    this.backgrounds.set(sessionId, hex);
  }

  async isProcessing(sessionId: string): Promise<boolean> {
    return this.processing.get(sessionId) ?? false;
  }

  async pollPanes(targets: { sessionId: string; pinName?: string }[]): Promise<Map<string, { processing: boolean }>> {
    const m = new Map<string, { processing: boolean }>();
    for (const t of targets) {
      if (!this.windows.has(t.sessionId)) continue;
      if (t.pinName !== undefined) this.names.set(t.sessionId, t.pinName);
      m.set(t.sessionId, { processing: this.processing.get(t.sessionId) ?? false });
    }
    return m;
  }

  setProcessing(sessionId: string, v: boolean): void {
    this.processing.set(sessionId, v);
  }

  setScreen(sessionId: string, content: string): void {
    this.screens.set(sessionId, content);
  }
}

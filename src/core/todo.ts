import type { TodoState, TodoTask } from '../todo-store.js';

/** 引擎对外副作用全部经回调注入(index.ts 拼模板/落盘),引擎本体纯逻辑可单测。 */
export interface TodoCallbacks {
  now(): number;
  /**
   * 把任务下发给当前 lead;返回消息 id,被守卫丢弃/无法送达时 undefined(引擎靠巡查兜底重试)。
   * pos: 显示用位置(1-based,用于「第 pos/total 条」);seq: taskdone 指令用 id,不归零。
   */
  dispatch(task: TodoTask, pos: number, total: number, isResend: boolean): string | undefined;
  /**
   * 巡查询问(模板自包含任务内容,同时就是下发失败的重试);返回是否发送成功。
   * pos: 显示用位置(1-based);seq: taskdone 指令用 id。
   * info.fruitless: 本次之前的连续无果次数(≥1 时模板升级措辞);info.nextMinutes: 下次巡查间隔(分钟,模板告知)。
   */
  nudge(task: TodoTask, pos: number, total: number, info: { fruitless: number; nextMinutes: number }): boolean;
  /** 撤掉仍在 inbox 排队的旧下发(重发防叠两份)。 */
  cancelQueued(msgId: string): void;
  announceSummary(tasks: TodoTask[]): void;
  announceSuspended(): void;
  announceSendFailing(): void;
  /** lead 经 taskwait 声明等待外部过程:向 boss 公告(消息流可见,知道为什么安静)。 */
  announceWaiting(task: TodoTask, minutes: number, reason: string): void;
  /** 连续 STALL_ANNOUNCE_AT 次无果巡查:疑似任务已完成未关闭或停滞,向 boss 告警(边沿一次)。 */
  announceStalled(task: TodoTask, n: number, intervalMinutes: number): void;
  /** todo 模式:推进到新任务时同步调用一次,实现方异步把非 lead 员工重置为全新会话(引擎不等待)。 */
  resetWorkers(): void;
  /** todo 模式:每 K 条完成时,推进新任务前重置 lead(实现方 = clearOneWorker(lead),含文档重加载)。 */
  resetLead(): void;
  /** /todo clear 弃单时:删除 lead 项目状态档(白纸)。 */
  wipeLeadMemory(): void;
  /** 当前重置周期 K(实现方现取 config);返回 0 表示关闭,引擎永不触发 resetLead。 */
  leadResetEvery(): number;
  removedByBossText(): string;
  persist(st: TodoState): void;
}

export type TodoResult = { ok: boolean; error?: string };

const MIN_MS = 60_000;
const FAIL_ANNOUNCE_AT = 3; // 连续发送失败这么多次 → 边沿公告一次
const WAIT_CAP_MIN = 120; // taskwait 单次等待上限(分钟):防 lead 一句声明把巡查睡死
const BACKOFF_CAP_MIN = 60;   // 无果退避封顶(分钟);nudgeMinutes 配得更长时取后者
const STALL_ANNOUNCE_AT = 3;  // 连续无果巡查达此次数 → 边沿告警一次(疑似已完成未关闭/停滞)

export class TodoEngine {
  private st: TodoState;
  private seqCounter: number;
  private lastDispatchId?: string; // 最近一次下发的消息 id(撤排队用;运行时瞬态,不落盘——重启后 inbox 本就清空)
  private idleSince?: number;      // 巡查计时锚点(下发/有人忙/巡查发出时刻);undefined=尚未开始计时
  private suspended = false;       // 运行时瞬态:无 lead 挂起
  private failStreak = 0;
  private failAnnounced = false;
  private fruitlessNudges = 0; // 自上次进度信号(taskdone/taskwait/下发)以来的无果巡查次数:驱动指数退避

  constructor(private cb: TodoCallbacks, initial?: TodoState) {
    this.st = initial ?? { state: 'idle', nudgeMinutes: 10, tasks: [] };
    this.seqCounter = this.st.tasks.reduce((m, t) => Math.max(m, t.seq), 0);
  }

  /** 只读快照(GET /admin/todo / 控制台进度行)。 */
  state(): TodoState { return this.st; }

  add(body: string): { ok: true; seq: number } {
    if (this.st.state === 'finished') { // 跑完直接续单:清旧账转 idle(汇总已入消息流不丢信息)
      this.st.tasks = [];
      this.st.state = 'idle';
    }
    const task: TodoTask = { seq: ++this.seqCounter, body, status: 'pending' };
    this.st.tasks.push(task);
    this.cb.persist(this.st);
    return { ok: true, seq: task.seq };
  }

  /** 批量建单(lead 经 MCP todoplan 调用):整单原子——任一条不合法则整体拒绝,不部分写入。
   *  冲突矩阵:running/paused 拒绝;finished 清旧账(同 add);idle 非空默认拒绝(防覆盖 boss 手动单),
   *  replace=true 时清空后建(lead 修订自己刚建的清单的正路)。 */
  plan(tasks: string[], replace: boolean): { ok: true; seqs: number[] } | { ok: false; error: string } {
    if (this.st.state === 'running' || this.st.state === 'paused')
      return { ok: false, error: 'todolist is running/paused — cannot replan now' };
    if (tasks.length === 0 || tasks.some((b) => !b.trim()))
      return { ok: false, error: 'tasks must be a non-empty list of non-blank strings' };
    if (this.st.state === 'finished') { // 跑完续单:清旧账(汇总已入消息流)
      this.st.tasks = [];
      this.st.state = 'idle';
    } else if (this.st.tasks.length > 0) {
      if (!replace) return { ok: false, error: 'todolist already has tasks — pass replace:true to rebuild, or ask boss to /todo clear' };
      this.st.tasks = [];
    }
    const seqs = tasks.map((body) => {
      const task: TodoTask = { seq: ++this.seqCounter, body, status: 'pending' };
      this.st.tasks.push(task);
      return task.seq;
    });
    this.st.completedSinceLeadReset = 0; // 新一摊活:重置 lead 重置计数
    this.cb.persist(this.st);
    return { ok: true, seqs };
  }

  rm(seq: number): TodoResult {
    const t = this.st.tasks.find((x) => x.seq === seq);
    if (!t) return { ok: false, error: `no task #${seq}` };
    if (t.status === 'pending') {
      this.st.tasks = this.st.tasks.filter((x) => x.seq !== seq);
      this.cb.persist(this.st);
      return { ok: true };
    }
    if (t.status === 'current' && this.st.state === 'paused') { // 脱困:跳过卡死的当前条
      t.status = 'failed';
      t.result = this.cb.removedByBossText();
      t.ts = this.cb.now();
      this.clearWait(); // 等待声明随任务移除作废
      if (this.lastDispatchId) this.cb.cancelQueued(this.lastDispatchId); // 旧下发可能还在 inbox 排队:撤掉,防 boss 已移除的任务事后送达
      this.lastDispatchId = undefined;
      // 若移除后已无 pending/current → 退回 idle(无需 resume,直接可重新 start)
      if (!this.st.tasks.some((x) => x.status === 'pending' || x.status === 'current')) {
        // 没任务可跑了:本轮终结,出汇总(与 resume 收尾路径一致)。转 finished 才能让后续 add 正确清旧账。
        this.st.state = 'finished';
        this.cb.persist(this.st);
        this.cb.announceSummary(this.st.tasks);
        return { ok: true };
      }
      this.cb.persist(this.st);
      return { ok: true };
    }
    return { ok: false, error: 'only pending tasks (or the current one while paused) can be removed' };
  }

  clear(): TodoResult {
    if (this.st.state === 'running') return { ok: false, error: 'todolist is running — /todo stop first' };
    this.cb.wipeLeadMemory(); // 弃单 → 删 lead 记忆(白纸)
    this.st = { state: 'idle', nudgeMinutes: this.st.nudgeMinutes, tasks: [], completedSinceLeadReset: 0 };
    if (this.lastDispatchId) this.cb.cancelQueued(this.lastDispatchId); // 旧下发可能还在 inbox 排队:撤掉,防 boss 已移除的任务事后送达
    this.lastDispatchId = undefined;
    this.cb.persist(this.st);
    return { ok: true };
  }

  start(nMinutes: number | undefined, hasLead: boolean): TodoResult {
    if (this.st.state === 'running') return { ok: false, error: 'already running' };
    if (this.st.state === 'paused') return { ok: false, error: 'paused — use /todo resume' };
    if (this.st.state === 'finished') return { ok: false, error: 'finished — /todo add new tasks or /todo clear' };
    if (!this.st.tasks.some((t) => t.status === 'pending')) return { ok: false, error: 'todolist is empty' };
    if (!hasLead) return { ok: false, error: 'no lead — set one with /lead first' };
    if (nMinutes !== undefined && (!Number.isInteger(nMinutes) || nMinutes <= 0))
      return { ok: false, error: 'nudge minutes must be a positive integer' };
    if (nMinutes !== undefined) this.st.nudgeMinutes = nMinutes;
    this.st.state = 'running';
    this.suspended = false;
    this.dispatchNext(false);
    return { ok: true };
  }

  stop(): TodoResult {
    if (this.st.state !== 'running') return { ok: false, error: 'not running' };
    this.st.state = 'paused';
    this.cb.persist(this.st);
    return { ok: true };
  }

  resume(hasLead: boolean): TodoResult {
    if (this.st.state !== 'paused') return { ok: false, error: 'nothing paused' };
    if (!hasLead) return { ok: false, error: 'no lead — set one with /lead first' };
    this.st.state = 'running';
    this.suspended = false;
    this.redispatch();
    return { ok: true };
  }

  taskdone(seq: number, status: 'done' | 'failed', result: string): TodoResult {
    if (this.st.state !== 'running' && this.st.state !== 'paused') return { ok: false, error: 'no active todolist' };
    const cur = this.st.tasks.find((t) => t.status === 'current');
    if (!cur) return { ok: false, error: 'no current task' };
    if (cur.seq !== seq) return { ok: false, error: `current task is #${cur.seq}, not #${seq}` };
    cur.status = status;
    cur.result = result;
    cur.ts = this.cb.now();
    this.st.completedSinceLeadReset = (this.st.completedSinceLeadReset ?? 0) + 1;
    this.lastDispatchId = undefined;
    if (this.st.state === 'running') this.dispatchNext(false); // 内含 persist(及 clearWait)
    else { this.clearWait(); this.cb.persist(this.st); }       // paused:只记录,resume 再推进;等待声明随完结作废
    return { ok: true };
  }

  /** lead 声明"任务推进中,等待外部过程(长脚本/CI),X 分钟内暂停巡查"。
   *  仅 running 且 seq 必须是 current——等待是当前任务的属性;到期由 tick 自动清除并恢复正常节奏。 */
  taskwait(seq: number, minutes: number, reason: string): TodoResult {
    if (this.st.state !== 'running') return { ok: false, error: 'no running todolist' };
    const cur = this.st.tasks.find((t) => t.status === 'current');
    if (!cur) return { ok: false, error: 'no current task' };
    if (cur.seq !== seq) return { ok: false, error: `current task is #${cur.seq}, not #${seq}` };
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > WAIT_CAP_MIN)
      return { ok: false, error: `minutes must be an integer in 1..${WAIT_CAP_MIN}` };
    this.st.waitUntil = this.cb.now() + minutes * MIN_MS;
    this.st.waitReason = reason.trim() || undefined;
    this.fruitlessNudges = 0; // 等待声明=进度信号,退避归零
    this.cb.persist(this.st);
    this.cb.announceWaiting(cur, minutes, reason.trim());
    return { ok: true };
  }

  /** 健康轮询(≈1.5s)驱动:lead 缺失挂起/恢复、空闲巡查。仅 running 生效。 */
  tick(anyBusy: boolean, hasLead: boolean): void {
    if (this.st.state !== 'running') return;
    if (!hasLead) {
      if (!this.suspended) { this.suspended = true; this.cb.announceSuspended(); } // 边沿一次
      return;
    }
    if (this.suspended) { // lead 回归:重发 current(新 lead 没上下文)
      this.suspended = false;
      this.redispatch();
      return;
    }
    const cur = this.st.tasks.find((t) => t.status === 'current');
    if (!cur) return;
    const now = this.cb.now();
    if (anyBusy) { this.idleSince = now; return; } // 有人在干活,计时重置(锚定在本次事件时刻)
    if (this.st.waitUntil !== undefined) {
      if (now < this.st.waitUntil) { this.idleSince = now; return; } // 等待期:不巡查,锚点持续推进
      // 到期:锚点至少从到期时刻起算(等待期内可能没有 tick 推进锚点),再正常计满 nudgeMinutes 才巡查
      this.idleSince = Math.max(this.idleSince ?? 0, this.st.waitUntil);
      this.st.waitUntil = undefined; this.st.waitReason = undefined; this.cb.persist(this.st); // 过期清除
    }
    if (this.idleSince === undefined) { this.idleSince = now; return; }
    if (now - this.idleSince >= this.nudgeIntervalMin(this.fruitlessNudges) * MIN_MS) {
      const pos = this.st.tasks.indexOf(cur) + 1; // 显示用位置(1-based);cur 必在列表中
      const info = { fruitless: this.fruitlessNudges, nextMinutes: this.nudgeIntervalMin(this.fruitlessNudges + 1) };
      if (this.cb.nudge(cur, pos, this.st.tasks.length, info)) {
        this.noteSendOk();
        this.fruitlessNudges++;
        if (this.fruitlessNudges === STALL_ANNOUNCE_AT)
          this.cb.announceStalled(cur, this.fruitlessNudges, this.nudgeIntervalMin(this.fruitlessNudges));
        this.idleSince = now; // 发出即重置(下一轮按退避后的间隔)
      } else this.noteSendFail(); // 失败不重置:下一 tick 立刻重试
    }
  }

  /** 无果 n 次后的巡查间隔(分钟):nudgeMinutes×2^n,封顶 max(60, nudgeMinutes)。 */
  private nudgeIntervalMin(n: number): number {
    return Math.min(this.st.nudgeMinutes * 2 ** n, Math.max(BACKOFF_CAP_MIN, this.st.nudgeMinutes));
  }

  /** 清等待声明:等待声明是 current 任务的属性,任务完结/移除即作废(不清则 state() 快照会展示已完结任务的等待)。调用方负责 persist。 */
  private clearWait(): void {
    this.st.waitUntil = undefined;
    this.st.waitReason = undefined;
  }

  /** 推进:current 完结后取下一条 pending 下发;没有了 → finished+汇总。 */
  private dispatchNext(isResend: boolean): void {
    this.clearWait(); // 等待声明随旧任务作废
    this.fruitlessNudges = 0; // 新一轮下发=进度信号,退避归零
    let task = this.st.tasks.find((t) => t.status === 'current');
    if (!task) {
      task = this.st.tasks.find((t) => t.status === 'pending');
      if (!task) {
        this.st.state = 'finished';
        this.cb.persist(this.st);
        this.cb.announceSummary(this.st.tasks);
        return;
      }
      task.status = 'current';
    }
    if (!isResend) this.cb.resetWorkers(); // 仅新任务推进时重置员工(重发=同一 current,员工可能在干,不清)
    if (!isResend) {
      const k = this.cb.leadResetEvery();
      if (k > 0 && (this.st.completedSinceLeadReset ?? 0) >= k) {
        this.cb.resetLead();
        this.st.completedSinceLeadReset = 0;
      }
    }
    const id = this.cb.dispatch(task, this.st.tasks.indexOf(task) + 1, this.st.tasks.length, isResend);
    if (id) { this.lastDispatchId = id; this.noteSendOk(); }
    else this.noteSendFail(); // 下发被丢:不标已派发,巡查模板自包含,满 N 自然兜底重试
    this.idleSince = this.cb.now(); // 下发(含尝试)即重置巡查计时(锚定在下发时刻)
    this.cb.persist(this.st);
  }

  /** resume/换 lead 后的重发:先撤可能仍在排队的旧下发,防 lead 顺序收到两份。 */
  private redispatch(): void {
    if (this.lastDispatchId) { this.cb.cancelQueued(this.lastDispatchId); this.lastDispatchId = undefined; }
    this.dispatchNext(true);
  }

  private noteSendOk(): void { this.failStreak = 0; this.failAnnounced = false; }
  private noteSendFail(): void {
    this.failStreak++;
    if (this.failStreak >= FAIL_ANNOUNCE_AT && !this.failAnnounced) { this.failAnnounced = true; this.cb.announceSendFailing(); }
  }
}

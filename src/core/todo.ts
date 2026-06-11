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
   */
  nudge(task: TodoTask, pos: number, total: number): boolean;
  /** 撤掉仍在 inbox 排队的旧下发(重发防叠两份)。 */
  cancelQueued(msgId: string): void;
  announceSummary(tasks: TodoTask[]): void;
  announceSuspended(): void;
  announceSendFailing(): void;
  removedByBossText(): string;
  persist(st: TodoState): void;
}

export type TodoResult = { ok: boolean; error?: string };

const MIN_MS = 60_000;
const FAIL_ANNOUNCE_AT = 3; // 连续发送失败这么多次 → 边沿公告一次

export class TodoEngine {
  private st: TodoState;
  private seqCounter: number;
  private lastDispatchId?: string; // 最近一次下发的消息 id(撤排队用;运行时瞬态,不落盘——重启后 inbox 本就清空)
  private idleSince?: number;      // 巡查计时锚点(下发/有人忙/巡查发出时刻);undefined=尚未开始计时
  private suspended = false;       // 运行时瞬态:无 lead 挂起
  private failStreak = 0;
  private failAnnounced = false;

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
    this.st = { state: 'idle', nudgeMinutes: this.st.nudgeMinutes, tasks: [] };
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
    this.lastDispatchId = undefined;
    if (this.st.state === 'running') this.dispatchNext(false); // 内含 persist
    else this.cb.persist(this.st);                             // paused:只记录,resume 再推进
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
    if (this.idleSince === undefined) { this.idleSince = now; return; }
    if (now - this.idleSince >= this.st.nudgeMinutes * MIN_MS) {
      const pos = this.st.tasks.indexOf(cur) + 1; // 显示用位置(1-based);cur 必在列表中
      if (this.cb.nudge(cur, pos, this.st.tasks.length)) { this.noteSendOk(); this.idleSince = now; } // 发出即重置(每满 N 一问)
      else this.noteSendFail(); // 失败不重置:下一 tick 立刻重试
    }
  }

  /** 推进:current 完结后取下一条 pending 下发;没有了 → finished+汇总。 */
  private dispatchNext(isResend: boolean): void {
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

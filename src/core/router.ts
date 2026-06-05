import type { AgentName, AgentRuntime, Message } from './types.js';
import type { Guards } from './guards.js';

export interface Deliverer {
  /** Router 决定"现在该把 msg 投给 agent 了"时调用；实现负责真正注入（副作用）。 */
  deliver(agent: AgentRuntime, msg: Message): void;
}

export interface RouterDeps {
  now: () => number;
  genId: () => string;
  routes?: Record<string, AgentName>; // role/别名 -> 真实 agent 名
  guards?: Guards;
  onLog?: (msg: Message) => void; // 每条消息入流水后回调（用于持久化）
  logCap?: number; // 内存流水滚动上限（默认 300）
}

export class Router {
  private agents = new Map<AgentName, AgentRuntime>();
  private messageLog: Message[] = [];

  /** 全局消息流水（供 admin /log 查看）。 */
  messages(): Message[] {
    return [...this.messageLog];
  }

  /** 用持久化的历史消息预填流水（启动恢复时用），按上限截断。 */
  seedLog(msgs: Message[]): void {
    const cap = this.deps.logCap ?? 300;
    this.messageLog = msgs.slice(-cap);
  }

  /** 注册一个虚拟成员（如 boss）：无窗口、立即 idle、消息只入日志不注入。 */
  addVirtual(name: AgentName, role?: string): void {
    this.agents.set(name, { name, role, status: 'idle', inbox: [], virtual: true });
  }

  constructor(private deliverer: Deliverer, private deps: RouterDeps) {}

  addAgent(name: AgentName, role?: string): void {
    this.agents.set(name, { name, role, status: 'launching', inbox: [] });
  }

  register(name: AgentName, sessionId: string): void {
    const a = this.must(name);
    a.sessionId = sessionId;
    a.status = 'idle';
    this.pump(a);
  }

  resolve(to: AgentName): AgentName | undefined {
    if (this.agents.has(to)) return to;
    const routed = this.deps.routes?.[to];
    return routed && this.agents.has(routed) ? routed : undefined;
  }

  send(from: AgentName, to: AgentName, body: string): Message | undefined {
    const target = this.resolve(to);
    if (!target) return undefined;
    const a = this.must(target);
    if (a.status === 'dead') return undefined;

    const g = this.deps.guards;
    let thread: string | undefined;
    if (g) {
      // thread = 无序对 {from,to}：A↔B 来回算同一 thread（循环/回合上限照常保护），
      // 但 A→B 与 A→C 是不同对、各自独立计数——协调者(如 lead)扇出给多人不再共用一个 thread 的回合数被静默丢弃。
      // 线程归属按对方判定：只有回复你正在处理的那条消息的发信人才续用同一线程，发给别人=新线程。
      // boss(虚拟/从不 handling)每次都新线程→人发起的长对话不撞回合上限；agent 互相来回仍共用线程被护栏挡；扇出给多人各自独立。
      const sender = this.agents.get(from);
      thread = sender?.handling && sender.handlingFrom === target ? sender.handling : g.newThread();
      const dec = g.checkMessage(thread, body);
      if (!dec.ok) {
        console.warn(`[guard] thread ${thread} broken: ${dec.reason} (${from} -> ${target})`);
        return undefined;
      }
      if (!g.allowInjection()) {
        console.warn(`[guard] rate limit hit, dropping ${from} -> ${target}`);
        return undefined;
      }
    }

    const msg: Message = { id: this.deps.genId(), from, to: target, body, ts: this.deps.now(), thread };
    this.messageLog.push(msg);
    const cap = this.deps.logCap ?? 300;
    if (this.messageLog.length > cap) this.messageLog.shift();
    this.deps.onLog?.(msg);
    if (a.virtual) return msg;       // 虚拟成员：只记日志，不注入、不置 busy
    a.inbox.push(msg);
    this.pump(a);
    return msg;
  }

  onIdle(name: AgentName): void {
    const a = this.must(name);
    if (a.status === 'busy' || a.status === 'stuck') a.status = 'idle';
    a.handling = undefined;
    a.handlingFrom = undefined;
    this.pump(a);
  }

  markDead(name: AgentName): void {
    this.must(name).status = 'dead';
  }

  markStuck(name: AgentName): void {
    const a = this.must(name);
    if (a.status === 'busy') a.status = 'stuck';
  }

  /**
   * 暂时标忙（如 /clear 清空上下文期间）：让发来的消息进 inbox 排队，
   * 不会投进正在清空/重启的 pane。员工清完重新 register（→idle）会自动把排队的 pump 出去。
   */
  hold(name: AgentName): void {
    const a = this.agents.get(name);
    if (a && a.status !== 'dead') { a.status = 'busy'; a.handling = undefined; a.handlingFrom = undefined; }
  }

  get(name: AgentName): AgentRuntime | undefined {
    return this.agents.get(name);
  }

  roster(): AgentRuntime[] {
    return [...this.agents.values()];
  }

  /** 若 agent 空闲且 inbox 非空，取出一条投递并标 busy。 */
  private pump(a: AgentRuntime): void {
    if (a.status !== 'idle') return;
    const msg = a.inbox.shift();
    if (!msg) return;
    a.status = 'busy';
    a.handling = msg.thread;
    a.handlingFrom = msg.from;
    this.deliverer.deliver(a, msg);
  }

  /** 从花名册移除一个 agent（运行时删员工）。未知名为 no-op。 */
  removeAgent(name: AgentName): void {
    this.agents.delete(name);
  }

  private must(name: AgentName): AgentRuntime {
    const a = this.agents.get(name);
    if (!a) throw new Error(`unknown agent: ${name}`);
    return a;
  }
}

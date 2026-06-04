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
}

export class Router {
  private agents = new Map<AgentName, AgentRuntime>();
  private messageLog: Message[] = [];

  /** 全局消息流水（供 admin /log 查看）。 */
  messages(): Message[] {
    return [...this.messageLog];
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
      const sender = this.agents.get(from);
      thread = sender?.handling ?? g.newThread();
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
    if (a.virtual) return msg;       // 虚拟成员：只记日志，不注入、不置 busy
    a.inbox.push(msg);
    this.pump(a);
    return msg;
  }

  onIdle(name: AgentName): void {
    const a = this.must(name);
    if (a.status === 'busy' || a.status === 'stuck') a.status = 'idle';
    a.handling = undefined;
    this.pump(a);
  }

  markDead(name: AgentName): void {
    this.must(name).status = 'dead';
  }

  markStuck(name: AgentName): void {
    const a = this.must(name);
    if (a.status === 'busy') a.status = 'stuck';
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
    this.deliverer.deliver(a, msg);
  }

  private must(name: AgentName): AgentRuntime {
    const a = this.agents.get(name);
    if (!a) throw new Error(`unknown agent: ${name}`);
    return a;
  }
}

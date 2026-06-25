import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { runtimeDir } from './runtime.js';
import { DEFAULT_OFFICE, officeSuffix } from './core/office.js';

/**
 * 诊断事件流水:记录"会悄悄打断协作流程"的事件,便于反复卡死后回溯定位。
 * 三类:
 * - guard-drop:消息被守卫(回合上限/循环/限流)拦下、整条丢弃 → 收件人永远收不到。
 * - inject-fail:消息已出队但注入 pane 失败 → 消息丢失,发件人却以为发出去了。
 * - auto-idle:健康轮询把某员工自动判为 idle(可能在它还没真正回完时就降,导致下一条排队消息叠注入)。
 * - agent-unresponsive:失联告警(A-1 报到超时 / A-2 有活无声),边沿触发、每次失联只记一条。
 */
export const DIAG_CAP = 1000;

export type DiagEvent =
  | { kind: 'guard-drop'; from: string; to: string; reason: string; thread?: string; ts: number }
  | { kind: 'inject-fail'; to: string; error: string; msgId?: string; ts: number }
  | { kind: 'auto-idle'; name: string; sinceDeliverMs: number; ts: number }
  | { kind: 'agent-unresponsive'; name: string; rule: 'register-timeout' | 'mute'; ts: number }
  | { kind: 'poll'; name: string; status: string; proc: boolean; scrape: boolean; paneBusy: boolean; grace: boolean; streak: number; action: string; bottom: string; ts: number }
  | { kind: 'todo-send-failing'; ts: number }
  | { kind: 'todo-workers-timeout'; ts: number } // 等员工就绪超时,仍按计划派发当前任务
  | { kind: 'todo-stalled'; seq: number; n: number; ts: number } // 任务连续 n 次巡查无上报(疑似完成未关闭/停滞)
  | { kind: 'bootstrap-fail'; name: string; error: string; ts: number }
  | { kind: 'poll-frozen'; streak: number; error: string; ts: number } // 批量轮询连续整轮失败(状态冻结);

/** 每个 (项目目录, 办公室) 一份诊断流水:~/.falinks/diag/<sha1(cwd)前16位[--office]>.jsonl。root 可注入便于测试。
 *  注:base 沿用 sha1(cwd)(与 message-log 同款,未 realpath),为默认办公室逐字节兼容而保留;office 后缀规则与全局一致。 */
export function diagPath(cwd: string, root = runtimeDir(), office: string = DEFAULT_OFFICE): string {
  const key = createHash('sha1').update(cwd).digest('hex').slice(0, 16) + officeSuffix(office);
  return join(root, 'diag', `${key}.jsonl`);
}

/** 追加一条诊断事件(O(1) 追加)。 */
export function appendDiag(cwd: string, ev: DiagEvent, root = runtimeDir(), office: string = DEFAULT_OFFICE): void {
  const p = diagPath(cwd, root, office);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(ev) + '\n');
}

/** 读最近 cap 条;坏行跳过;文件超过 2×cap 行时顺手压缩重写。 */
export function loadDiag(cwd: string, cap = DIAG_CAP, root = runtimeDir(), office: string = DEFAULT_OFFICE): DiagEvent[] {
  const p = diagPath(cwd, root, office);
  if (!existsSync(p)) return [];
  let lines: string[];
  try {
    lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }
  const evs = lines
    .map((l) => { try { return JSON.parse(l) as DiagEvent; } catch { return null; } })
    .filter((e): e is DiagEvent => e !== null);
  const tail = evs.slice(-cap);
  if (evs.length > cap * 2) {
    try { writeFileSync(p, tail.map((e) => JSON.stringify(e)).join('\n') + '\n'); } catch { /* 压缩失败无所谓 */ }
  }
  return tail;
}

/** 清空某 (项目, 办公室) 的诊断流水(删除文件)。不存在为 no-op。 */
export function clearDiag(cwd: string, root = runtimeDir(), office: string = DEFAULT_OFFICE): void {
  rmSync(diagPath(cwd, root, office), { force: true });
}

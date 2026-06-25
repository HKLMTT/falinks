// P1 收件箱合并投递(Inbox Coalescing)验收 —— 契约 docs/P1-INBOX-COALESCING.md §4。
//
// 两段式:
//   ① always-on:现在就跑——pump 1 条零变化基线、guards 与投递解耦(合并不触发 loop)。
//      这两条在 batch 落地前后都成立,长期守门。
//   ② skipIf(batchMode):合并语义(3 条同 sender 一次投递、deliver 次数=pump 次数、多 sender、
//      busy 入队 idle 批量 drain)+ formatBatch + i18n header。batch 未落地整组 skip,npm test 全绿。
//
// 自动探测 batchMode:对 idle agent 先发 1 条(投出转 busy)、再塞 3 条排队、onIdle 触发一次 pump,
// 看那次 pump 是【1 次 deliver 且 payload 为长度 3 的数组】(=合并生效) 还是逐条(=旧行为)。
// 同理探测 orchestrator.formatBatch / i18n.inboxBatchHeader 是否就位。
//
// ⚠ 待 backend 对齐(lead 转签名后 qa 收口):deliver(agent, Message[]) 形态、formatBatch 确切名、
//   inboxBatchHeader 键名。本文件用"捕获 deliver 第二参(数组或单条)+ 探测导出"尽量解耦。

import { describe, expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import * as orch from '../../src/orchestrator.js';
import { formatMessage } from '../../src/orchestrator.js';
import { setLocale } from '../../src/i18n/index.js';
import { zh } from '../../src/i18n/zh.js';
import { en } from '../../src/i18n/en.js';

// ── 录制型 deliverer + Router 装配 ──────────────────────────────────────────
type Call = { agent: any; payload: any };
function setup() {
  const calls: Call[] = [];
  let n = 0;
  const deliverer: Deliverer = { deliver: (agent: any, payload: any) => { calls.push({ agent, payload }); } } as any;
  const router = new Router(deliverer, { now: () => 1000, genId: () => `m${++n}` });
  router.addAgent('alice');
  router.register('alice', 'SID'); // → idle(inbox 空,pump 无操作)
  return { router, calls };
}
// payload 可能是单条(旧)或数组(合并);统一成数组取用。
const msgsOf = (p: any): any[] => (Array.isArray(p) ? p : [p]);

// ── 探测:batch 合并是否已生效 ───────────────────────────────────────────────
const batchMode = (() => {
  try {
    const { router, calls } = setup();
    router.send('boss', 'alice', '0');                       // idle→投出→busy(pump #1)
    router.send('boss', 'alice', '1');
    router.send('boss', 'alice', '2');
    router.send('boss', 'alice', '3');                       // busy→入队 3 条
    router.onIdle('alice');                                  // pump #2:drain
    const drain = calls[calls.length - 1]?.payload;
    return Array.isArray(drain) && drain.length === 3;       // 合并:一次投出 3 条数组
  } catch { return false; }
})();

const hasFormatBatch = typeof (orch as any).formatBatch === 'function';
const hasHeader = typeof (zh as any).inboxBatchHeader !== 'undefined' && typeof (en as any).inboxBatchHeader !== 'undefined';

// ════════════════════════════════════════════════════════════════════════
// ① always-on:单条零变化 + guards/投递解耦
// ════════════════════════════════════════════════════════════════════════
describe('基线:pump 1 条 → 单条投递、无额外包装', () => {
  test('恰一次 deliver,载荷就是那一条,agent 置 busy、inbox 空、handling 记账', () => {
    const { router, calls } = setup();
    const m = router.send('boss', 'alice', 'hi')!;
    expect(calls).toHaveLength(1);
    const msgs = msgsOf(calls[0].payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe('hi');
    expect(msgs[0].id).toBe(m.id);
    // 经 deliver 捕获的 live agent 引用断言状态机
    const a = calls[0].agent;
    expect(a.status).toBe('busy');
    expect(a.inbox).toHaveLength(0);
    expect(a.handlingFrom).toBe('boss');
    expect(a.handling).toBe(m.thread);
  });

  test('单条投递文本 == 现有 formatMessage(逐字一致,formatBatch 长度1 分支不得加噪)', () => {
    setLocale('zh');
    const msg = { id: 'm1', from: 'boss', to: 'alice', body: '正文', ts: 1, thread: undefined } as any;
    const single = formatMessage(msg);
    if (hasFormatBatch) {
      expect((orch as any).formatBatch([msg])).toBe(single); // 长度1 == 旧 formatMessage
    } else {
      expect(single).toContain('boss');
      expect(single).toContain('正文');
    }
  });
});

describe('不变量:guards 仅在 send 时生效,投递/drain 不触发(合并不误触 loop)', () => {
  test('checkMessage 调用数 = send 次数;onIdle 批量 drain 不新增 guard 调用', () => {
    const calls: Call[] = [];
    let n = 0;
    let checkCount = 0;
    let threadSeq = 0;
    const guards = {
      newThread: () => `t${++threadSeq}`,
      checkMessage: (_thread: string, _body: string) => { checkCount++; return { ok: true as const }; },
      allowInjection: () => true,
    };
    const deliverer: Deliverer = { deliver: (agent: any, payload: any) => { calls.push({ agent, payload }); } } as any;
    const router = new Router(deliverer, { now: () => 1, genId: () => `m${++n}`, guards } as any);
    router.addAgent('alice');
    router.register('alice', 'SID');

    router.send('boss', 'alice', 'a'); // 投出→busy
    router.send('boss', 'alice', 'b'); // 入队
    router.send('boss', 'alice', 'c'); // 入队
    expect(checkCount).toBe(3);         // 三次 send → 三次 guard 判定
    const before = checkCount;
    router.onIdle('alice');             // drain(投递期)——不应再判 guard
    expect(checkCount).toBe(before);    // drain 没有触发任何 guard/loop 判定
  });
});

describe('不变量:urgent 跳过合并批次,忙时立即单独直送', () => {
  test('busy 时 urgent → 立刻 deliver([urgent]) 单独投出,不混进普通批;普通消息仍在队', () => {
    const { router, calls } = setup();
    router.send('boss', 'alice', 'a');                       // → busy,deliver #1
    const b = router.send('boss', 'alice', 'b')!;            // busy → 普通入队
    expect(calls).toHaveLength(1);
    const u = router.send('boss', 'alice', 'u', { urgent: true })!; // 忙时 urgent → 直送
    expect(calls).toHaveLength(2);                           // 立即多一次投递
    const urg = msgsOf(calls[1].payload);
    expect(urg).toHaveLength(1);                             // 单独一条,不与 b 合批
    expect(urg[0].body).toBe('u');
    expect(router.queuedMessageIds().has(b.id)).toBe(true);  // 普通消息 b 仍排队,未被 urgent 带出
    expect(router.queuedMessageIds().has(u.id)).toBe(false); // urgent 已投出
  });
});

// ════════════════════════════════════════════════════════════════════════
// ② skipIf(batchMode):合并语义
// ════════════════════════════════════════════════════════════════════════
describe.skipIf(!batchMode)('§4 合并:pump 3 条(同 sender)一次投递', () => {
  test('一次 drain → deliver 调 1 次、含全 3 条、inbox 清空、busy、handling/From=最后一条', () => {
    const { router, calls } = setup();
    router.send('boss', 'alice', 'a');                 // 投出→busy(call #1)
    const b = router.send('boss', 'alice', 'b')!;
    const c = router.send('boss', 'alice', 'c')!;
    const d = router.send('boss', 'alice', 'd')!;      // 入队 3 条
    const base = calls.length;
    router.onIdle('alice');                            // 一次 pump drain

    expect(calls.length - base).toBe(1);               // 仅 1 次新 deliver
    const drain = calls[calls.length - 1];
    const msgs = msgsOf(drain.payload);
    expect(msgs.map((m) => m.body)).toEqual(['b', 'c', 'd']);
    expect(msgs.every((m) => m.from === 'boss')).toBe(true);
    const a = drain.agent;
    expect(a.status).toBe('busy');
    expect(a.inbox).toHaveLength(0);
    expect(a.handlingFrom).toBe('boss');
    expect(a.handling).toBe(d.thread);                 // 记账用最后一条
    expect([b, c]).not.toContain(undefined);
  });
});

describe.skipIf(!batchMode)('§4 deliver 调用次数 = pump 次数(非消息条数)', () => {
  test('4 条消息、2 次 pump → 恰 2 次 deliver', () => {
    const { router, calls } = setup();
    router.send('boss', 'alice', 'a');   // pump #1(idle→busy)→ deliver #1
    router.send('boss', 'alice', 'b');   // busy→入队(不投)
    router.send('boss', 'alice', 'c');
    router.send('boss', 'alice', 'd');
    router.onIdle('alice');              // pump #2 → deliver #2(b/c/d 合并)
    expect(calls).toHaveLength(2);       // ← 合并的核心证据:2 次,而非 4 次
  });
});

describe.skipIf(!batchMode)('§4 多 sender 批 → 一次投递含全部、from 归属正确、handling=最后一条', () => {
  test('bob/carol/dave 各一条排队 → 一次 drain 含 3、from 各自、handlingFrom=dave', () => {
    const { router, calls } = setup();
    router.send('boss', 'alice', 'x');   // 先占 busy
    router.send('bob', 'alice', 'b1');
    router.send('carol', 'alice', 'c1');
    router.send('dave', 'alice', 'd1');
    const base = calls.length;
    router.onIdle('alice');
    expect(calls.length - base).toBe(1);
    const drain = calls[calls.length - 1];
    const msgs = msgsOf(drain.payload);
    expect(msgs.map((m) => m.from)).toEqual(['bob', 'carol', 'dave']);
    expect(drain.agent.handlingFrom).toBe('dave');
  });
});

describe.skipIf(!batchMode)('§4 busy 期间到达入队不投;idle 后一次性 drain', () => {
  test('busy 时入队不产生 deliver;queued 反映排队;onIdle 一次 drain 清空', () => {
    const { router, calls } = setup();
    router.send('boss', 'alice', 'a');   // → busy,deliver #1
    expect(calls).toHaveLength(1);
    const m2 = router.send('boss', 'alice', 'b')!;
    const m3 = router.send('boss', 'alice', 'c')!;
    expect(calls).toHaveLength(1);       // busy 期间到达:不投
    expect(router.queuedMessageIds().has(m2.id)).toBe(true);
    expect(router.queuedMessageIds().has(m3.id)).toBe(true);
    router.onIdle('alice');
    expect(calls).toHaveLength(2);       // 一次性 drain
    expect(msgsOf(calls[1].payload).map((m) => m.body)).toEqual(['b', 'c']);
    expect(router.queuedMessageIds().size).toBe(0);
  });
});

// ── formatBatch(≥2 条)──────────────────────────────────────────────────────
describe.skipIf(!hasFormatBatch || !hasHeader)('§4 formatBatch:≥2 条 = 头部 + 编号 + from 归属', () => {
  test('含 inboxBatchHeader(n) + 每条 from 与正文', () => {
    setLocale('zh');
    const m1 = { id: 'm1', from: 'bob', to: 'alice', body: '第一条', ts: 1 } as any;
    const m2 = { id: 'm2', from: 'carol', to: 'alice', body: '第二条', ts: 2 } as any;
    const s = (orch as any).formatBatch([m1, m2]);
    const header = (zh as any).inboxBatchHeader(2);
    expect(s).toContain(header);
    expect(s).toContain('bob');
    expect(s).toContain('第一条');
    expect(s).toContain('carol');
    expect(s).toContain('第二条');
  });
});

// ── i18n parity:inboxBatchHeader ────────────────────────────────────────────
describe.skipIf(!hasHeader)('§4 i18n inboxBatchHeader zh/en parity', () => {
  test('zh/en 均为函数、产物非空且体现条数 n', () => {
    const z = (zh as any).inboxBatchHeader;
    const e = (en as any).inboxBatchHeader;
    expect(typeof z).toBe('function');
    expect(typeof e).toBe('function');
    expect(String(z(3)).length).toBeGreaterThan(0);
    expect(String(e(3)).length).toBeGreaterThan(0);
    expect(String(z(3))).toContain('3');
    expect(String(e(3))).toContain('3');
  });
});

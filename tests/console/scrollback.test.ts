import { expect, test } from 'vitest';
import { appendCommitted, pendingCounts } from '../../src/console/scrollback.js';

type M = { id: string; from: string; to: string; body: string; ts: number; queued?: boolean };
const m = (id: string, to = 'qa', queued = false): M => ({ id, from: 'boss', to, body: id, ts: Number(id), queued });

test('appendCommitted:按 log 顺序追加未见过的 id,已提交不动、引用稳定', () => {
  const c0: M[] = [];
  const c1 = appendCommitted(c0, [m('1'), m('2')]);
  expect(c1.map((x) => x.id)).toEqual(['1', '2']);
  const c2 = appendCommitted(c1, [m('1'), m('2'), m('3')]);
  expect(c2.map((x) => x.id)).toEqual(['1', '2', '3']);
  expect(c2[0]).toBe(c1[0]);
  expect(c2[1]).toBe(c1[1]);
});

test('appendCommitted:无新增时返回同一引用', () => {
  const c1 = appendCommitted([], [m('1')]);
  const c2 = appendCommitted(c1, [m('1')]);
  expect(c2).toBe(c1);
});

test('appendCommitted:queued 与否都提交(发送顺序,不乱序)', () => {
  const c = appendCommitted([], [m('1', 'qa', true), m('2', 'backend', false)]);
  expect(c.map((x) => x.id)).toEqual(['1', '2']);
});

test('appendCommitted:同一批内重复 id 去重(防撞号→同 key),保留首次', () => {
  const dup = appendCommitted([], [m('1', 'qa'), m('1', 'backend'), m('2', 'ux')]);
  expect(dup.map((x) => x.id)).toEqual(['1', '2']);
  expect(dup[0].to).toBe('qa');
});

test('pendingCounts:仅算 queued,按目标聚合条数、保首现顺序;无则空', () => {
  expect(pendingCounts([m('1', 'qa', true), m('2', 'backend', true), m('3', 'qa', true), m('4', 'ux', false)]))
    .toEqual([{ to: 'qa', n: 2 }, { to: 'backend', n: 1 }]);
  expect(pendingCounts([m('1', 'qa', false)])).toEqual([]);
});

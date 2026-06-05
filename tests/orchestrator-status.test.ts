import { expect, test } from 'vitest';
import { reconcilePaneStatus } from '../src/orchestrator.js';

const base = { gracePassed: true, idleStreak: 3, idleThreshold: 3 };

test('路由以为 idle 但 pane 在生成 → 升 busy(修「干活却显示空闲」)', () => {
  expect(reconcilePaneStatus({ ...base, status: 'idle', paneBusy: true })).toBe('mark-busy');
});

test('idle 且 pane 也空闲 → 不动', () => {
  expect(reconcilePaneStatus({ ...base, status: 'idle', paneBusy: false })).toBe('none');
});

test('busy、pane 空闲、过宽限、连续达阈值 → 降 idle', () => {
  expect(reconcilePaneStatus({ ...base, status: 'busy', paneBusy: false })).toBe('mark-idle');
});

test('busy、pane 空闲、但连续不足阈值 → 不动(去抖:防工具间隙/滚屏瞬时空窗误降)', () => {
  expect(reconcilePaneStatus({ ...base, status: 'busy', paneBusy: false, idleStreak: 2 })).toBe('none');
});

test('busy 但 pane 仍在生成 → 不动', () => {
  expect(reconcilePaneStatus({ ...base, status: 'busy', paneBusy: true })).toBe('none');
});

test('busy、pane 空闲、但未过投递宽限 → 不降(避开「已提交未开始生成」空窗)', () => {
  expect(reconcilePaneStatus({ ...base, status: 'busy', paneBusy: false, gracePassed: false })).toBe('none');
});

test('launching / dead / stuck 一律不动', () => {
  for (const status of ['launching', 'dead', 'stuck']) {
    expect(reconcilePaneStatus({ ...base, status, paneBusy: true })).toBe('none');
    expect(reconcilePaneStatus({ ...base, status, paneBusy: false })).toBe('none');
  }
});

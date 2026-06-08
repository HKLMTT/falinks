import { expect, test } from 'vitest';
import { moveSel, windowRange } from '../../src/console/log-format.js';

// moveSel(selBack, total, dir):selBack=距最新多少条(0=最新),null=实时态。
test('moveSel:从实时态按 older(ctrl+↑)进入回看,选中最新(selBack=0)', () => {
  expect(moveSel(null, 5, 'older')).toBe(0);
});

test('moveSel:从实时态按 newer(ctrl+↓)无操作,仍实时', () => {
  expect(moveSel(null, 5, 'newer')).toBe(null);
});

test('moveSel:older 往更早走,封顶在最早一条(total-1)', () => {
  expect(moveSel(0, 5, 'older')).toBe(1);
  expect(moveSel(4, 5, 'older')).toBe(4); // 已在最早,不再增
});

test('moveSel:newer 往更新走,越过最新→退出回看(null)', () => {
  expect(moveSel(2, 5, 'newer')).toBe(1);
  expect(moveSel(0, 5, 'newer')).toBe(null); // 已是最新,再 newer 就退出
});

test('moveSel:空历史→null', () => {
  expect(moveSel(null, 0, 'older')).toBe(null);
});

// windowRange(selIdx, total, size):返回 [start,end) 让选中条落在窗口内。
test('windowRange:总数不超过窗口→全展示', () => {
  expect(windowRange(2, 4, 6)).toEqual({ start: 0, end: 4 });
});

test('windowRange:居中选中,边界夹紧', () => {
  expect(windowRange(10, 100, 5)).toEqual({ start: 8, end: 13 }); // 10 - floor(5/2)=8
  expect(windowRange(0, 100, 5)).toEqual({ start: 0, end: 5 });   // 顶部夹紧
  expect(windowRange(99, 100, 5)).toEqual({ start: 95, end: 100 }); // 底部夹紧
});

import { expect, test } from 'vitest';
import { moveSel, windowRange, windowByHeight, browseRowBudget, scrollWindow, displayWidth, wrapRows } from '../../src/console/log-format.js';

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

// windowByHeight(selIdx, total, budget, heightAt):选中条作末条、向上按真实行高(含条间距+1)填。
// 配合贴底渲染:选中条恒在底部完整可见,溢出裁顶。
const H = (h: number) => () => h; // 所有消息等高的 heightAt

test('windowByHeight:空历史→{0,0}', () => {
  expect(windowByHeight(0, 0, 100, H(1))).toEqual({ start: 0, end: 0 });
});

test('windowByHeight:选中条即末条(end=selIdx+1),不显示更新的消息', () => {
  expect(windowByHeight(2, 4, 100, H(2))).toEqual({ start: 0, end: 3 }); // 向上填到顶,idx3(更新)不入窗
});

test('windowByHeight:选中条永远在窗口内、且是最后一条', () => {
  for (const sel of [0, 5, 50, 99]) {
    const w = windowByHeight(sel, 100, 9, H(1));
    expect(sel >= w.start && sel < w.end).toBe(true);
    expect(w.end).toBe(sel + 1); // 选中条是末条
  }
});

test('windowByHeight:窗口总高(含条间距)不超 budget', () => {
  const w = windowByHeight(50, 100, 9, H(1)); // 每条1行,加条间距1
  const count = w.end - w.start;
  const rows = count + (count - 1);
  expect(rows).toBeLessThanOrEqual(9);
});

test('windowByHeight:贴底回看(选中近末尾、消息很高)选中条仍完整可见且不溢出', () => {
  // 复现 bug:total=489,选中第486条(idx=485),每条5行,budget=12
  const w = windowByHeight(485, 489, 12, H(5));
  expect(485 >= w.start && 485 < w.end).toBe(true);
  expect(w.end).toBe(486); // 选中条贴底(末条)
  const count = w.end - w.start;
  const rows = count * 5 + (count - 1);
  expect(rows).toBeLessThanOrEqual(12);
});

test('windowByHeight:选中条自身超 budget,也至少显示它', () => {
  expect(windowByHeight(2, 5, 10, (i) => (i === 2 ? 100 : 1))).toEqual({ start: 2, end: 3 });
});

test('windowByHeight:选中条是第0条→窗口只有它', () => {
  expect(windowByHeight(0, 50, 100, H(1))).toEqual({ start: 0, end: 1 });
});

// browseRowBudget(rows, rosterLen):回看消息区可用行数(保守,防溢出)。
test('browseRowBudget:随终端高度增长、随花名册变长而减少、有下限', () => {
  expect(browseRowBudget(60, 6)).toBeGreaterThan(browseRowBudget(40, 6));
  expect(browseRowBudget(60, 12)).toBeLessThan(browseRowBudget(60, 3));
  expect(browseRowBudget(10, 6)).toBeGreaterThanOrEqual(3); // 矮终端保底
});

// displayWidth:CJK/全角=2,ASCII=1(给折行估算用)。
test('displayWidth:中文按 2、ASCII 按 1', () => {
  expect(displayWidth('abc')).toBe(3);
  expect(displayWidth('中文')).toBe(4);
  expect(displayWidth('a中b')).toBe(4);
  expect(displayWidth('')).toBe(0);
});

// wrapRows(width, cols):一行文本按列宽折成几行(至少 1)。
test('wrapRows:按列宽向上取整,至少 1', () => {
  expect(wrapRows(0, 80)).toBe(1);
  expect(wrapRows(80, 80)).toBe(1);
  expect(wrapRows(81, 80)).toBe(2);
  expect(wrapRows(160, 80)).toBe(2);
  expect(wrapRows(10, 0)).toBe(1); // 列宽异常兜底
});

// scrollWindow(prevStart, selIdx, total, budget, heightAt):光标在视口内移动,撞边才滚动视口。
test('scrollWindow:光标在视口内上移时视口不动(start 不变)', () => {
  // budget=9、每条1行+条间距 → 容纳 5 条。先在 selIdx=13、视口[10,15)
  const w1 = scrollWindow(10, 13, 20, 9, H(1));
  expect(w1).toEqual({ start: 10, end: 15 });
  // 上移到 11,仍在视口内 → start 仍 10(只是光标动,视口不动)
  expect(scrollWindow(w1.start, 11, 20, 9, H(1))).toEqual({ start: 10, end: 15 });
  expect(scrollWindow(w1.start, 10, 20, 9, H(1))).toEqual({ start: 10, end: 15 }); // 到顶仍不动
});

test('scrollWindow:光标越过视口顶 → 视口上滚一条', () => {
  const w = scrollWindow(10, 9, 20, 9, H(1)); // 从[10,15)再往上,选中 9 < 10
  expect(w.start).toBe(9);
  expect(9 >= w.start && 9 < w.end).toBe(true);
});

test('scrollWindow:光标跌出视口底(大跳) → 选中条贴底', () => {
  const w = scrollWindow(5, 18, 20, 9, H(1));
  expect(w.end).toBe(19);                 // 选中条为末条(贴底)
  expect(18 >= w.start && 18 < w.end).toBe(true);
});

test('scrollWindow:进入回看(选中=最新、prevStart 失效)→ 最新贴底、向上填满视口', () => {
  // prevStart 给个过大的失效值,selIdx=19(最新)
  const w = scrollWindow(999, 19, 20, 9, H(1));
  expect(w.end).toBe(20);
  expect(w.start).toBe(15);               // 向上填满 budget(5 条)
});

test('scrollWindow:选中条恒在窗口内', () => {
  for (const [prev, sel] of [[0, 0], [3, 7], [50, 2], [10, 19]] as const) {
    const w = scrollWindow(prev, sel, 20, 9, H(1));
    expect(sel >= w.start && sel < w.end).toBe(true);
  }
});

test('scrollWindow:幂等(同 selIdx 再算一次结果不变)', () => {
  const a = scrollWindow(999, 12, 30, 9, H(1));
  const b = scrollWindow(a.start, 12, 30, 9, H(1));
  expect(b).toEqual(a);
});

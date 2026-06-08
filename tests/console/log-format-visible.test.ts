import { expect, test } from 'vitest';
import { visibleCount } from '../../src/console/log-format.js';

test('visibleCount:随终端高度增长(不再固定 6)', () => {
  expect(visibleCount(60, 6)).toBeGreaterThan(6); // 高终端显示更多
  expect(visibleCount(80, 6)).toBeGreaterThan(visibleCount(40, 6)); // 越高越多
});

test('visibleCount:矮终端保底 6', () => {
  expect(visibleCount(8, 6)).toBe(6);
  expect(visibleCount(20, 6)).toBe(6);
});

test('visibleCount:超高终端封顶 60', () => {
  expect(visibleCount(1000, 6)).toBe(60);
});

test('visibleCount:花名册越长,留给消息的越少', () => {
  expect(visibleCount(60, 12)).toBeLessThanOrEqual(visibleCount(60, 3));
});

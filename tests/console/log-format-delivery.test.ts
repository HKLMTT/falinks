import { expect, test } from 'vitest';
import { deliveryState } from '../../src/console/log-format.js';

const roster = [
  { name: 'alice', virtual: false },
  { name: 'boss', virtual: true },
];

test('deliveryState:目标员工 + 在队列 → queued', () => {
  expect(deliveryState('alice', true, roster)).toBe('queued');
});

test('deliveryState:目标员工 + 不在队列 → delivered', () => {
  expect(deliveryState('alice', false, roster)).toBe('delivered');
});

test('deliveryState:目标是虚拟成员(boss)→ none(不显示徽标)', () => {
  expect(deliveryState('boss', false, roster)).toBe('none');
  expect(deliveryState('boss', true, roster)).toBe('none');
});

test('deliveryState:目标不在花名册 → none', () => {
  expect(deliveryState('ghost', false, roster)).toBe('none');
});

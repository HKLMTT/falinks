import { expect, test } from 'vitest';
import { isNewer, upgradeCommand } from '../src/update.js';

test('detects a newer patch/minor/major', () => {
  expect(isNewer('0.1.2', '0.1.1')).toBe(true);
  expect(isNewer('0.2.0', '0.1.9')).toBe(true);
  expect(isNewer('1.0.0', '0.9.9')).toBe(true);
});

test('equal or older is not newer', () => {
  expect(isNewer('0.1.1', '0.1.1')).toBe(false);
  expect(isNewer('0.1.0', '0.1.1')).toBe(false);
  expect(isNewer('0.0.9', '0.1.0')).toBe(false);
});

test('ignores pre-release suffix', () => {
  expect(isNewer('0.1.2-beta', '0.1.1')).toBe(true);
  expect(isNewer('0.1.1-beta', '0.1.1')).toBe(false);
});

test('upgradeCommand builds the global sudo install command', () => {
  expect(upgradeCommand('@hklmtt/falinks')).toBe('sudo npm i -g @hklmtt/falinks');
});

import { expect, test } from 'vitest';
import { escapeAppleScript } from '../../src/terminal/applescript.js';

test('escapes backslashes first', () => {
  expect(escapeAppleScript('a\\b')).toBe('a\\\\b');
});

test('escapes double quotes', () => {
  expect(escapeAppleScript('say "hi"')).toBe('say \\"hi\\"');
});

test('converts newline to literal \\n (AppleScript LF)', () => {
  expect(escapeAppleScript('line1\nline2')).toBe('line1\\nline2');
});

test('strips carriage returns', () => {
  expect(escapeAppleScript('a\r\nb')).toBe('a\\nb');
});

test('combined: quote + backslash + newline order is correct', () => {
  expect(escapeAppleScript('\\"\n')).toBe('\\\\\\"\\n');
});

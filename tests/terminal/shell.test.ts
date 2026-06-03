import { expect, test } from 'vitest';
import { shQuote } from '../../src/terminal/iterm.js';

test('wraps a simple path in single quotes', () => {
  expect(shQuote('/tmp/x')).toBe("'/tmp/x'");
});

test('preserves spaces inside the quotes', () => {
  expect(shQuote('/Users/foo bar/proj')).toBe("'/Users/foo bar/proj'");
});

test('escapes embedded single quotes the POSIX way', () => {
  // a'b  ->  'a'\''b'
  expect(shQuote("a'b")).toBe("'a'\\''b'");
});

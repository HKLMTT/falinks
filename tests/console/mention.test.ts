import { expect, test } from 'vitest';
import { mentionState, applyMention } from '../../src/console/mention.js';

const names = ['alice', 'bob', 'boss'];

test('bare @ activates with all names', () => {
  const s = mentionState('@', names);
  expect(s.active).toBe(true);
  expect(s.query).toBe('');
  expect(s.matches).toEqual(['alice', 'bob', 'boss']);
});

test('@a matches alice only', () => {
  expect(mentionState('@a', names).matches).toEqual(['alice']);
});

test('@b matches bob and boss', () => {
  expect(mentionState('@b', names).matches).toEqual(['bob', 'boss']);
});

test('mention at end of a longer line is detected', () => {
  const s = mentionState('hi @al', names);
  expect(s.query).toBe('al');
  expect(s.matches).toEqual(['alice']);
});

test('case-insensitive match', () => {
  expect(mentionState('@AL', names).matches).toEqual(['alice']);
});

test('no @ -> inactive', () => {
  expect(mentionState('hello world', names).active).toBe(false);
});

test('@ followed by space is no longer an active mention', () => {
  expect(mentionState('@alice hello', names).active).toBe(false);
});

test('@ with no matches -> inactive', () => {
  expect(mentionState('@zzz', names).active).toBe(false);
});

test('applyMention replaces the trailing @query with @name + space', () => {
  expect(applyMention('@al', 'alice')).toBe('@alice ');
  expect(applyMention('hi @b', 'bob')).toBe('hi @bob ');
});

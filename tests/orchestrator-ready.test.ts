import { expect, test } from 'vitest';
import { detectScreenState } from '../src/orchestrator.js';

test('detects the trust dialog', () => {
  expect(detectScreenState('... Is this a project you created or one you trust? ... 1. Yes, I trust')).toBe('trust-dialog');
});

test('detects the ready prompt (claude box)', () => {
  expect(detectScreenState('Claude Code v2.1.161\n❯ \n  for agents')).toBe('ready');
});

test('detects the codex trust dialog', () => {
  expect(detectScreenState('Do you trust the contents of this directory?\n› 1. Yes, continue\n  2. No, quit')).toBe('trust-dialog');
});

test('returns starting when neither marker present', () => {
  expect(detectScreenState('Last login: ...\n$ claude')).toBe('starting');
});

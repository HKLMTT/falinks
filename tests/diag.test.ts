import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagPath, appendDiag, loadDiag, clearDiag, type DiagEvent } from '../src/diag.js';

const DROP = (i: number): DiagEvent => ({ kind: 'guard-drop', from: 'a', to: 'b', reason: 'turn-cap', ts: i });

test('diagPath 按 cwd 稳定、在 diag/ 下、.jsonl', () => {
  const root = '/x/.falinks';
  expect(diagPath('/p/foo', root)).toBe(diagPath('/p/foo', root));
  expect(diagPath('/p/foo', root).startsWith(join(root, 'diag'))).toBe(true);
  expect(diagPath('/p/foo', root).endsWith('.jsonl')).toBe(true);
  expect(diagPath('/p/bar', root)).not.toBe(diagPath('/p/foo', root));
});

test('append 后 load 往返;不存在返回空', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-diag-'));
  const cwd = '/p/foo';
  expect(loadDiag(cwd, 300, root)).toEqual([]);
  appendDiag(cwd, DROP(1), root);
  appendDiag(cwd, DROP(2), root);
  expect(loadDiag(cwd, 300, root)).toEqual([DROP(1), DROP(2)]);
});

test('load 按 cap 只取最近若干条', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-diag-'));
  const cwd = '/p/foo';
  for (let i = 1; i <= 10; i++) appendDiag(cwd, DROP(i), root);
  expect((loadDiag(cwd, 3, root) as DiagEvent[]).map((e) => e.ts)).toEqual([8, 9, 10]);
});

test('坏行被跳过,不抛', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-diag-'));
  const cwd = '/p/foo';
  appendDiag(cwd, DROP(1), root);
  appendFileSync(diagPath(cwd, root), '{ broken\n');
  appendDiag(cwd, DROP(2), root);
  expect((loadDiag(cwd, 300, root) as DiagEvent[]).map((e) => e.ts)).toEqual([1, 2]);
});

test('clearDiag 删除文件,之后 load 返回空;不存在不抛', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-diag-'));
  const cwd = '/p/foo';
  appendDiag(cwd, DROP(1), root);
  expect(loadDiag(cwd, 300, root)).toHaveLength(1);
  clearDiag(cwd, root);
  expect(loadDiag(cwd, 300, root)).toEqual([]);
  expect(() => clearDiag('/p/none', root)).not.toThrow();
});

test('支持三类事件结构', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-diag-'));
  const cwd = '/p/foo';
  const evs: DiagEvent[] = [
    { kind: 'guard-drop', from: 'lead', to: 'qa', reason: 'loop', thread: 'th9', ts: 1 },
    { kind: 'inject-fail', to: 'frontend', error: 'pane gone', msgId: 'm7', ts: 2 },
    { kind: 'auto-idle', name: 'backend', sinceDeliverMs: 3200, ts: 3 },
  ];
  for (const e of evs) appendDiag(cwd, e, root);
  expect(loadDiag(cwd, 300, root)).toEqual(evs);
});

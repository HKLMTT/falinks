import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { messageLogPath, appendMessageLog, loadMessageLog, clearMessageLog } from '../src/message-log.js';

const M = (i: number) => ({ id: `m${i}`, from: 'boss', to: 'alice', body: `msg ${i}`, ts: i });

test('messageLogPath 按 cwd 稳定、在 messages/ 下、.jsonl', () => {
  const root = '/x/.falinks';
  expect(messageLogPath('/p/foo', root)).toBe(messageLogPath('/p/foo', root));
  expect(messageLogPath('/p/foo', root).startsWith(join(root, 'messages'))).toBe(true);
  expect(messageLogPath('/p/foo', root).endsWith('.jsonl')).toBe(true);
  expect(messageLogPath('/p/bar', root)).not.toBe(messageLogPath('/p/foo', root));
});

test('append 后 load 往返;不存在返回空', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-msg-'));
  const cwd = '/p/foo';
  expect(loadMessageLog(cwd, 300, root)).toEqual([]);
  appendMessageLog(cwd, M(1), root);
  appendMessageLog(cwd, M(2), root);
  expect(loadMessageLog(cwd, 300, root)).toEqual([M(1), M(2)]);
});

test('load 按 cap 只取最近若干条', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-msg-'));
  const cwd = '/p/foo';
  for (let i = 1; i <= 10; i++) appendMessageLog(cwd, M(i), root);
  const got = loadMessageLog(cwd, 3, root);
  expect(got.map((m: any) => m.id)).toEqual(['m8', 'm9', 'm10']);
});

test('文件超过 2×cap 行时压缩重写到最近 cap 条', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-msg-'));
  const cwd = '/p/foo';
  for (let i = 1; i <= 7; i++) appendMessageLog(cwd, M(i), root); // 7 > 2*3
  loadMessageLog(cwd, 3, root); // 触发压缩
  const lines = readFileSync(messageLogPath(cwd, root), 'utf8').split('\n').filter((l) => l.trim());
  expect(lines.length).toBe(3);
  expect(JSON.parse(lines[0]).id).toBe('m5');
});

test('clearMessageLog 删除流水,之后 load 返回空', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-msg-'));
  const cwd = '/p/foo';
  appendMessageLog(cwd, M(1), root);
  appendMessageLog(cwd, M(2), root);
  expect(loadMessageLog(cwd, 300, root)).toHaveLength(2);
  clearMessageLog(cwd, root);
  expect(loadMessageLog(cwd, 300, root)).toEqual([]);
});

test('clearMessageLog 文件不存在时不抛', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-msg-'));
  expect(() => clearMessageLog('/p/none', root)).not.toThrow();
});

test('坏行被跳过,不抛', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-msg-'));
  const cwd = '/p/foo';
  appendMessageLog(cwd, M(1), root);
  const fs = appendFileSync;
  fs(messageLogPath(cwd, root), '{ broken\n');
  appendMessageLog(cwd, M(2), root);
  expect(loadMessageLog(cwd, 300, root).map((m: any) => m.id)).toEqual(['m1', 'm2']);
});

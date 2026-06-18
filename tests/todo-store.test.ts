// tests/todo-store.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadTodo, saveTodo, type TodoState } from '../src/todo-store.js';

const root = () => mkdtempSync(join(tmpdir(), 'falinks-todo-'));

test('不存在/损坏返回空壳', () => {
  const r = root();
  expect(loadTodo('/some/proj', r)).toEqual({ state: 'idle', nudgeMinutes: 10, tasks: [], completedSinceLeadReset: 0 });
});

test('round-trip', () => {
  const r = root();
  const st: TodoState = { state: 'paused', nudgeMinutes: 5, tasks: [{ seq: 1, body: 'x', status: 'done', result: 'ok', ts: 9 }], completedSinceLeadReset: 0 };
  saveTodo('/some/proj', st, r);
  expect(loadTodo('/some/proj', r)).toEqual(st);
});

test('载入时 running 一律降 paused(进程死过,文件说 running 不可信)', () => {
  const r = root();
  saveTodo('/p', { state: 'running', nudgeMinutes: 10, tasks: [{ seq: 1, body: 'x', status: 'current' }] }, r);
  expect(loadTodo('/p', r).state).toBe('paused');
});

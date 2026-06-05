import { expect, test } from 'vitest';
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  consoleLaunchCommand, runtimePath, runtimeDir,
  projectKey, instancePath, writeInstance, readInstance,
  removeInstanceIfOwner, listInstances,
  type InstanceInfo,
} from '../src/runtime.js';

test('consoleLaunchCommand uses tsx for a .ts entry (dev)', () => {
  expect(consoleLaunchCommand('/abs/src/cli.ts', '/usr/bin/node')).toBe('npx tsx /abs/src/cli.ts console');
});

test('consoleLaunchCommand uses node for a compiled .js entry', () => {
  expect(consoleLaunchCommand('/usr/lib/falinks/dist/cli.js', '/usr/bin/node')).toBe('/usr/bin/node /usr/lib/falinks/dist/cli.js console');
});

test('runtimePath lives under the runtime dir', () => {
  expect(runtimePath().startsWith(runtimeDir())).toBe(true);
  expect(runtimePath().endsWith('runtime.json')).toBe(true);
});

const tmpRoot = () => mkdtempSync(join(tmpdir(), 'falinks-rt-'));

test('projectKey 对符号链接和真实路径给出同一个 key', () => {
  const real = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-real-')));
  const link = join(mkdtempSync(join(tmpdir(), 'falinks-lnk-')), 'lnk');
  symlinkSync(real, link);
  expect(projectKey(link)).toBe(projectKey(real));
  expect(projectKey(real)).toMatch(/^[0-9a-f]{16}$/);
});

test('instance 文件写读删,按 cwd 寻址', () => {
  const root = tmpRoot();
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-p-')));
  const info: InstanceInfo = { port: 50001, pid: process.pid, cwd, startedAt: 1 };
  expect(writeInstance(info, root)).toBe(true);
  expect(readInstance(cwd, root)).toEqual(info);
  expect(instancePath(cwd, root).startsWith(join(root, 'runtime'))).toBe(true);
  removeInstanceIfOwner(cwd, process.pid, root);
  expect(readInstance(cwd, root)).toBeNull();
});

test('writeInstance 排他:已存在返回 false 不覆盖;force 才覆盖', () => {
  const root = tmpRoot();
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-p-')));
  const a: InstanceInfo = { port: 1, pid: 1, cwd, startedAt: 1 };
  const b: InstanceInfo = { port: 2, pid: 2, cwd, startedAt: 2 };
  expect(writeInstance(a, root)).toBe(true);
  expect(writeInstance(b, root)).toBe(false);
  expect(readInstance(cwd, root)!.port).toBe(1);
  expect(writeInstance(b, root, { force: true })).toBe(true);
  expect(readInstance(cwd, root)!.port).toBe(2);
});

test('removeInstanceIfOwner:pid 不匹配不删(防误删他人实例)', () => {
  const root = tmpRoot();
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-p-')));
  writeInstance({ port: 1, pid: 99999999, cwd, startedAt: 1 }, root);
  removeInstanceIfOwner(cwd, 1, root);
  expect(readInstance(cwd, root)).not.toBeNull();
});

test('listInstances 列出全部(损坏的跳过)', () => {
  const root = tmpRoot();
  const c1 = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-p1-')));
  const c2 = realpathSync(mkdtempSync(join(tmpdir(), 'falinks-p2-')));
  writeInstance({ port: 1, pid: 1, cwd: c1, startedAt: 1 }, root);
  writeInstance({ port: 2, pid: 2, cwd: c2, startedAt: 2 }, root);
  writeFileSync(join(root, 'runtime', 'broken.json'), '{oops');
  const all = listInstances(root);
  expect(all.map((e) => e.info.port).sort()).toEqual([1, 2]);
  expect(all[0].file.endsWith('.json')).toBe(true);
});

test('consoleLaunchCommand 带 port 时追加 --port', () => {
  expect(consoleLaunchCommand('/d/cli.js', '/usr/bin/node', 50123)).toBe('/usr/bin/node /d/cli.js console --port 50123');
});

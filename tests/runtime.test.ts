import { expect, test } from 'vitest';
import { consoleLaunchCommand, runtimePath, runtimeDir } from '../src/runtime.js';

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

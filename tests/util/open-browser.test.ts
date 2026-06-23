import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// mock node:child_process 的 spawn:记录调用、可被设置为抛错
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

let realPlatform: PropertyDescriptor | undefined;
function setPlatform(p: NodeJS.Platform) {
  realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockReturnValue({ unref: () => {}, on: () => {} });
});

afterEach(() => {
  if (realPlatform) Object.defineProperty(process, 'platform', realPlatform);
  realPlatform = undefined;
  vi.resetModules();
});

test('darwin 用 open 打开 url', async () => {
  setPlatform('darwin');
  const { openBrowser } = await import('../../src/util/open-browser.js');
  openBrowser('http://127.0.0.1:1234/office');
  expect(spawnMock).toHaveBeenCalledTimes(1);
  const [cmd, args] = spawnMock.mock.calls[0];
  expect(cmd).toBe('open');
  expect(args).toEqual(['http://127.0.0.1:1234/office']);
});

test('linux 用 xdg-open', async () => {
  setPlatform('linux');
  const { openBrowser } = await import('../../src/util/open-browser.js');
  openBrowser('http://x/office');
  expect(spawnMock.mock.calls[0][0]).toBe('xdg-open');
});

test('win32 用 start', async () => {
  setPlatform('win32');
  const { openBrowser } = await import('../../src/util/open-browser.js');
  openBrowser('http://x/office');
  expect(spawnMock.mock.calls[0][0]).toBe('start');
});

test('spawn 抛错时不向外抛', async () => {
  setPlatform('darwin');
  spawnMock.mockImplementation(() => { throw new Error('boom'); });
  const { openBrowser } = await import('../../src/util/open-browser.js');
  expect(() => openBrowser('http://x')).not.toThrow();
});

test('detached + stdio ignore + unref', async () => {
  setPlatform('darwin');
  const unref = vi.fn();
  spawnMock.mockReturnValue({ unref, on: () => {} });
  const { openBrowser } = await import('../../src/util/open-browser.js');
  openBrowser('http://x');
  const opts = spawnMock.mock.calls[0][2];
  expect(opts).toMatchObject({ detached: true, stdio: 'ignore' });
  expect(unref).toHaveBeenCalled();
});

// CLI 简写 `falinks <名字>` = `falinks up --office <名字>` 验收。
// 纯函数在 src/cli-route.ts(可直接 import,不触发 cli.ts 的 main()):
//   resolveCliAction(cmd, office, rest): 'subcommand'|'office-shorthand'|'help'
//   CLI_SUBCOMMANDS = ['up','console','init','doctor','lang','say','broadcast','roster','log']
// 判定:cmd∈CLI_SUBCOMMANDS→'subcommand';
//      否则 office===DEFAULT_OFFICE && isValidOfficeName(cmd) && rest.length===0→'office-shorthand';
//      否则→'help'。
//
// 未落地(src/cli-route.ts 不存在)整组 skip,保持 npm test 全绿;落地后自动激活。

import { describe, expect, test } from 'vitest';
import { DEFAULT_OFFICE } from '../src/core/office.js';

let M: any = null;
try { M = await import('../src/cli-route.js'); } catch { /* pending backend */ }
const resolve: ((cmd: string | undefined, office: string, rest: string[]) => string) | null = M?.resolveCliAction ?? null;
// 用 backend 自己的清单做"逐个断言",防漏/防清单漂移;探测不到时回退到契约清单。
const SUBS: string[] = Array.isArray(M?.CLI_SUBCOMMANDS)
  ? M.CLI_SUBCOMMANDS
  : ['up', 'console', 'init', 'doctor', 'lang', 'say', 'broadcast', 'roster', 'log'];

describe.skipIf(!resolve)('resolveCliAction:cmd → subcommand | office-shorthand | help', () => {
  test('合法小写单参 → office-shorthand', () => {
    expect(resolve!('demo2', DEFAULT_OFFICE, [])).toBe('office-shorthand');
    for (const ok of ['a', 'team-a', 'x.y', 'o_o', 'proj1']) {
      expect(resolve!(ok, DEFAULT_OFFICE, [])).toBe('office-shorthand');
    }
  });

  test('全部 CLI_SUBCOMMANDS 逐个 → subcommand(防漏)', () => {
    expect(SUBS.length).toBeGreaterThanOrEqual(9);
    for (const sub of SUBS) {
      expect(resolve!(sub, DEFAULT_OFFICE, [])).toBe('subcommand');
    }
  });

  test('子命令带余参仍是 subcommand(up <cfg>、say <to> <msg>)', () => {
    expect(resolve!('up', DEFAULT_OFFICE, ['my.config.json'])).toBe('subcommand');
    expect(resolve!('say', DEFAULT_OFFICE, ['bob', 'hi'])).toBe('subcommand');
  });

  test('名字撞子命令词 → subcommand 优先(子命令判定在前,不当 office)', () => {
    // 'log'/'roster' 字符合法但属子命令词
    expect(resolve!('log', DEFAULT_OFFICE, [])).toBe('subcommand');
    expect(resolve!('roster', DEFAULT_OFFICE, [])).toBe('subcommand');
  });

  test('大写名(非法 office)→ help', () => {
    expect(resolve!('BadName', DEFAULT_OFFICE, [])).toBe('help');
    expect(resolve!('Demo', DEFAULT_OFFICE, [])).toBe('help');
  });

  test('保留名 default → help', () => {
    expect(resolve!('default', DEFAULT_OFFICE, [])).toBe('help');
  });

  test('合法名但 rest 非空 → help(shorthand 必须单参)', () => {
    expect(resolve!('demo2', DEFAULT_OFFICE, ['x'])).toBe('help');
    expect(resolve!('a', DEFAULT_OFFICE, ['b'])).toBe('help');
  });

  test('office ≠ default(已带 --office)→ 合法名也 help(不重复指定)', () => {
    expect(resolve!('demo2', 'someoffice', [])).toBe('help');
  });

  test('非法 office 字符单参(斜杠/.. /空格/非 ascii/非法首字符)→ help', () => {
    for (const bad of ['a/b', '..', 'a b', '团队', '-x', '.x']) {
      expect(resolve!(bad, DEFAULT_OFFICE, [])).toBe('help');
    }
  });
});

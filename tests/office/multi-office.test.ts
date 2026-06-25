// 多办公室(Multi-Office)验收 —— 契约稿 docs/MULTI-OFFICE-DESIGN.md §9。
// backend 已确认接口基准(lead 转达,本文件严格按此写):
//   1. office 形参一律在现有参数【末位】,默认 DEFAULT_OFFICE='default'。
//   2. keyFor 基准 = projectKey = sha1(realpath(cwd)).slice(0,16);默认无后缀,具名 `--<office>`。
//   3. ⚠ message-log 是【独立基准】:沿用历史 sha1(原始 cwd,未 realpath),只追加 officeSuffix,
//      不并入 keyFor。后缀规则一致(default 无 / 具名 `--<office>`),但 base 哈希不同 ——
//      断言 message-log 路径必须用它自己的 base,严禁用 keyFor。
//   4. writeInstance(info,...) 签名不变,office 随 info.office(旧测试传无 office 的 info → 默认路径)。
//   5. listOffices(cwd, root?) → { office, configPath, running, port? }[]。
//   6. 模块 src/office.ts 导出:DEFAULT_OFFICE / isValidOfficeName / assertOfficeName /
//      officeSuffix / keyFor / resolveConfigPath / listOffices;runtime/session/leadstate/
//      message-log 各 +office 末参;resolveBus(cwd, { ..., office })。
//
// 结构:① 回归基线 always-on(默认办公室逐字节锚点,现在就跑,backend 落地后继续守);
//       ② §9 契约组,office 模块未落地时整组 skip,保持 npm test 全绿,落地后自动激活。

import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { projectKey, instancePath, writeInstance, type InstanceInfo } from '../../src/runtime.js';
import { sessionStorePath } from '../../src/session/store.js';
import { messageLogPath } from '../../src/message-log.js';
import { leadStatePath } from '../../src/leadstate-store.js';
import { todoPath } from '../../src/todo-store.js';
import { diagPath } from '../../src/diag.js';
import { resolveBus } from '../../src/discovery.js';

// ── 工具 ────────────────────────────────────────────────────────────────
const tmpProject = () => realpathSync(mkdtempSync(join(tmpdir(), 'falinks-office-')));
const tmpRoot = () => mkdtempSync(join(tmpdir(), 'falinks-root-'));
const sha16 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

// ════════════════════════════════════════════════════════════════════════
// ① 回归基线(always-on):默认办公室布局 = golden。零迁移锚点。
//    backend 给路径函数加 office 末参(默认 DEFAULT_OFFICE)后,这些【不传 office】的
//    调用仍走默认分支,故本组落地后【继续通过】,成为长期的逐字节守门。
// ════════════════════════════════════════════════════════════════════════
describe('回归基线:默认办公室路径公式(逐字节锚点)', () => {
  test('runtime/sessions/leadstate = sha1(realpath(cwd)).16;message = sha1(原始 cwd).16', () => {
    const cwd = tmpProject(); // 已 realpath,故 raw cwd === realpath(cwd)
    const root = tmpRoot();
    const base = sha16(cwd);

    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(projectKey(cwd)).toBe(base);

    expect(instancePath(cwd, root)).toBe(join(root, 'runtime', `${base}.json`));
    expect(sessionStorePath(cwd, root)).toBe(join(root, 'sessions', `${base}.json`));
    expect(leadStatePath(cwd, root)).toBe(join(root, 'leadstate', `${base}.md`)); // 实际 .md(契约 §3.1 写 .txt,以代码为准)
    expect(todoPath(cwd, root)).toBe(join(root, 'todos', `${base}.json`));         // projectKey 基准
    expect(messageLogPath(cwd, root)).toBe(join(root, 'messages', `${base}.jsonl`));
    expect(diagPath(cwd, root)).toBe(join(root, 'diag', `${base}.jsonl`));         // 自身 base(原始 cwd)
  });

  test('message-log 与 diag 用【原始 cwd】哈希(不过 realpath),与其余基准不同源', () => {
    const real = tmpProject();
    const link = join(mkdtempSync(join(tmpdir(), 'falinks-lnk-')), 'lnk');
    symlinkSync(real, link);
    const root = tmpRoot();

    expect(messageLogPath(link, root)).toBe(join(root, 'messages', `${sha16(link)}.jsonl`)); // 原始 cwd
    expect(diagPath(link, root)).toBe(join(root, 'diag', `${sha16(link)}.jsonl`));           // 原始 cwd(同 message-log)
    expect(projectKey(link)).toBe(projectKey(real)); // 其余(含 todo):realpath 归一
    expect(messageLogPath(link, root)).not.toBe(messageLogPath(real, root)); // message-log 区分软链 vs 真实
    expect(diagPath(link, root)).not.toBe(diagPath(real, root));             // diag 同理
    expect(todoPath(link, root)).toBe(todoPath(real, root));                 // todo 走 projectKey,软链归一
  });
});

// ════════════════════════════════════════════════════════════════════════
// ② §9 契约组:backend office 模块落地后激活;未落地整组 skip。
// ════════════════════════════════════════════════════════════════════════
let O: any = null;
try { O = await import('../../src/core/office.js'); } catch { /* pending backend */ }
const ready = !!O;

// ── officeSuffix + keyFor(projectKey 基准)─────────────────────────────────
describe.skipIf(!ready)('§9 officeSuffix / keyFor(projectKey 基准)', () => {
  test('officeSuffix:默认空、具名 `--<office>`', () => {
    expect(O.officeSuffix(O.DEFAULT_OFFICE)).toBe('');
    expect(O.officeSuffix('sales')).toBe('--sales');
  });

  test('keyFor 默认 == projectKey(逐字节 == 旧 key),无后缀', () => {
    const cwd = tmpProject();
    expect(O.keyFor(cwd)).toBe(projectKey(cwd));                 // 末参缺省 = 默认办公室
    expect(O.keyFor(cwd, O.DEFAULT_OFFICE)).toBe(projectKey(cwd));
    expect(O.keyFor(cwd)).toMatch(/^[0-9a-f]{16}$/);
  });

  test('keyFor 具名 = projectKey + `--<office>`', () => {
    const cwd = tmpProject();
    expect(O.keyFor(cwd, 'sales')).toBe(`${projectKey(cwd)}--sales`);
  });

  test('同目录两办公室 key 互异,且都 != 默认', () => {
    const cwd = tmpProject();
    const a = O.keyFor(cwd, 'alpha'), b = O.keyFor(cwd, 'beta'), d = O.keyFor(cwd);
    expect(new Set([a, b, d]).size).toBe(3);
  });

  test('软链与真实路径 keyFor 同(沿用 realpath)', () => {
    const real = tmpProject();
    const link = join(mkdtempSync(join(tmpdir(), 'falinks-lnk-')), 'lnk');
    symlinkSync(real, link);
    expect(O.keyFor(link, 'sales')).toBe(O.keyFor(real, 'sales'));
  });
});

// ── 路径函数 office 末参(默认逐字节 + 具名后缀;message-log 独立基准)──────────
describe.skipIf(!ready)('§9 路径函数 +office 末参', () => {
  test('默认办公室(显式传 DEFAULT)逐字节 == 不传 office', () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    expect(instancePath(cwd, root, O.DEFAULT_OFFICE)).toBe(instancePath(cwd, root));
    expect(sessionStorePath(cwd, root, O.DEFAULT_OFFICE)).toBe(sessionStorePath(cwd, root));
    expect(leadStatePath(cwd, root, O.DEFAULT_OFFICE)).toBe(leadStatePath(cwd, root));
    expect(todoPath(cwd, root, O.DEFAULT_OFFICE)).toBe(todoPath(cwd, root));
    expect(messageLogPath(cwd, root, O.DEFAULT_OFFICE)).toBe(messageLogPath(cwd, root));
    expect(diagPath(cwd, root, O.DEFAULT_OFFICE)).toBe(diagPath(cwd, root));
  });

  test('具名:runtime/sessions/leadstate/todo 用 projectKey 基准 + 后缀', () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    const k = `${projectKey(cwd)}--sales`;
    expect(instancePath(cwd, root, 'sales')).toBe(join(root, 'runtime', `${k}.json`));
    expect(sessionStorePath(cwd, root, 'sales')).toBe(join(root, 'sessions', `${k}.json`));
    expect(leadStatePath(cwd, root, 'sales')).toBe(join(root, 'leadstate', `${k}.md`));
    expect(todoPath(cwd, root, 'sales')).toBe(join(root, 'todos', `${k}.json`));
  });

  test('具名:message-log 与 diag 用【自身 base(原始 cwd)】+ 后缀,不走 keyFor', () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    const mlBase = sha16(cwd); // message-log / diag 自身基准
    expect(messageLogPath(cwd, root, 'sales')).toBe(join(root, 'messages', `${mlBase}--sales.jsonl`));
    expect(diagPath(cwd, root, 'sales')).toBe(join(root, 'diag', `${mlBase}--sales.jsonl`));
  });
});

// ── resolveConfigPath ─────────────────────────────────────────────────────
describe.skipIf(!ready)('§9 resolveConfigPath(cwd, office)', () => {
  test('默认 → <cwd>/falinks.config.json(且缺省末参同义)', () => {
    const cwd = tmpProject();
    expect(O.resolveConfigPath(cwd)).toBe(join(cwd, 'falinks.config.json'));
    expect(O.resolveConfigPath(cwd, O.DEFAULT_OFFICE)).toBe(join(cwd, 'falinks.config.json'));
  });

  test('具名 → <cwd>/.falinks/<name>.config.json', () => {
    const cwd = tmpProject();
    expect(O.resolveConfigPath(cwd, 'sales')).toBe(join(cwd, '.falinks', 'sales.config.json'));
  });
});

// ── office 名校验:isValidOfficeName / assertOfficeName ──────────────────────
describe.skipIf(!ready)('§9 office 名校验(^[a-z0-9][a-z0-9._-]{0,31}$)', () => {
  const GOOD = ['s', 'sales', 'a1', 'team-x', 'x.y', 'o_o', 'a'.repeat(32)];
  // 纯字符/正则非法集(不含 default —— default 字符合法,仅作为保留名由 assertOfficeName 拦)
  const BAD_CHARS = [
    '',                  // 空
    'a/b', '/x', 'a\\b', // 路径分隔符
    '..', '.',           // 相对路径片段
    'a'.repeat(33),      // >32
    'a b',               // 空格
    'Sales',             // 大写(正则限定小写)
    '团队',              // 非 ascii
    '-x', '.x', '_x',    // 首字符须 [a-z0-9]
  ];

  test('isValidOfficeName:纯正则——合法 true / 非法字符 false;default 字符合法故 true', () => {
    for (const ok of GOOD) expect(O.isValidOfficeName(ok)).toBe(true);
    for (const bad of BAD_CHARS) expect(O.isValidOfficeName(bad)).toBe(false);
    expect(O.isValidOfficeName('default')).toBe(true); // 保留名判定不在此函数
  });

  test('assertOfficeName:合法静默 / 非法字符抛 / 保留名 default 抛', () => {
    for (const ok of GOOD) expect(() => O.assertOfficeName(ok)).not.toThrow();
    for (const bad of BAD_CHARS) expect(() => O.assertOfficeName(bad)).toThrow();
    expect(() => O.assertOfficeName('default')).toThrow(); // 保留名
  });
});

// ── listOffices(cwd, root?) → {office, configPath, running, port?}[] ─────────
describe.skipIf(!ready)('§9 listOffices', () => {
  test('空项目(无 config)→ 不含默认办公室', () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    const list = O.listOffices(cwd, root);
    expect(Array.isArray(list)).toBe(true);
    expect(list.map((e: any) => e.office)).not.toContain(O.DEFAULT_OFFICE);
  });

  test('falinks.config.json → 含默认办公室,configPath 指向它,无实例→running false', () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    writeFileSync(join(cwd, 'falinks.config.json'), JSON.stringify({ agents: [] }));
    const def = O.listOffices(cwd, root).find((e: any) => e.office === O.DEFAULT_OFFICE);
    expect(def).toBeTruthy();
    expect(def.configPath).toBe(join(cwd, 'falinks.config.json'));
    expect(def.running).toBe(false); // 没写实例档案 = 已停(确定性断言)
  });

  test('枚举 .falinks/*.config.json 具名办公室', () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    mkdirSync(join(cwd, '.falinks'), { recursive: true });
    writeFileSync(join(cwd, '.falinks', 'sales.config.json'), JSON.stringify({ agents: [] }));
    writeFileSync(join(cwd, '.falinks', 'qa.config.json'), JSON.stringify({ agents: [] }));
    const names = O.listOffices(cwd, root).map((e: any) => e.office);
    expect(names).toContain('sales');
    expect(names).toContain('qa');
    const sales = O.listOffices(cwd, root).find((e: any) => e.office === 'sales');
    expect(sales.configPath).toBe(join(cwd, '.falinks', 'sales.config.json'));
  });
});

// ── 双启动:office 随 info.office,排他基于 (cwd, office) ──────────────────────
describe.skipIf(!ready)('§9 双启动(writeInstance 按 info.office 排他)', () => {
  const inst = (port: number, cwd: string, office?: string): InstanceInfo & { office?: string } =>
    ({ port, pid: port, cwd, startedAt: 1, ...(office ? { office } : {}) });

  test('无 office 的 info → 默认路径,逐字节兼容', () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    expect(writeInstance(inst(60001, cwd), root)).toBe(true);
    // 默认实例落在旧 golden 路径
    expect(instancePath(cwd, root)).toBe(join(root, 'runtime', `${projectKey(cwd)}.json`));
  });

  test('同 (cwd, office) 二次写 → 排他挡(false)', () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    expect(writeInstance(inst(60011, cwd, 'sales'), root)).toBe(true);
    expect(writeInstance(inst(60012, cwd, 'sales'), root)).toBe(false);
  });

  test('同目录不同 office → 两者皆放行', () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    expect(writeInstance(inst(60021, cwd, 'sales'), root)).toBe(true);
    expect(writeInstance(inst(60022, cwd, 'qa'), root)).toBe(true);
  });

  test('默认与具名同目录互不挡', () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    expect(writeInstance(inst(60031, cwd), root)).toBe(true);            // 默认
    expect(writeInstance(inst(60032, cwd, 'sales'), root)).toBe(true);   // 具名
  });
});

// ── discovery:resolveBus(cwd, { office })──────────────────────────────────
describe.skipIf(!ready)('§9 resolveBus(cwd, { office })', () => {
  // 注:resolveBus 探活后校验 /admin/info 的 cwd 与 office(discovery.ts:66/78),fake 须回带 office。
  const aliveFetch = (cwd: string, office?: string) =>
    (async () => ({ ok: true, json: async () => ({ cwd: realpathSync(cwd), pid: 1, startedAt: 1, ...(office ? { office } : {}) }) })) as unknown as typeof fetch;

  test('命中 (cwd, office) 实例端口', async () => {
    const cwd = tmpProject();
    const root = tmpRoot();
    writeInstance({ port: 62001, pid: 1, cwd, startedAt: 1, office: 'sales' }, root);
    const r = await resolveBus(cwd, { root, fetchFn: aliveFetch(cwd, 'sales'), office: 'sales' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.port).toBe(62001);
  });

  test('默认办公室「借用唯一存活实例」兼容仍在', async () => {
    const cwd = tmpProject();
    const other = tmpProject();
    const root = tmpRoot();
    // 只放一个别目录的默认实例;本项目无实例 → 默认办公室借用
    writeInstance({ port: 63001, pid: 1, cwd: other, startedAt: 1 }, root);
    const r = await resolveBus(cwd, { root, fetchFn: aliveFetch(other), office: O.DEFAULT_OFFICE });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.port).toBe(63001);
  });

  test('具名办公室不借用别目录存活实例(命中失败即 not found)', async () => {
    const cwd = tmpProject();
    const other = tmpProject();
    const root = tmpRoot();
    writeInstance({ port: 64001, pid: 1, cwd: other, startedAt: 1, office: 'sales' }, root);
    // 本项目无 sales 实例 → 具名不借用,直接 not found
    const r = await resolveBus(cwd, { root, fetchFn: aliveFetch(other, 'sales'), office: 'sales' });
    expect(r.ok).toBe(false);
  });
});

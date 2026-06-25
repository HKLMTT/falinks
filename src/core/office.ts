import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { runtimeDir, projectKey, readInstance } from '../runtime.js';
import { t } from '../i18n/index.js';

/**
 * 多办公室(multi-office)助手:同一项目目录下并行多间独立办公室。
 * 默认办公室(DEFAULT_OFFICE)沿用旧路径,逐字节兼容、零迁移;具名办公室在 key/config 路径上加 `--<office>` / `.falinks/<office>`。
 */

/** 默认办公室 id(即"不填名"那间)。其 key/路径与旧版逐字节相同——勿改此常量。 */
export const DEFAULT_OFFICE = 'default';

/** 合法 office 名:ascii,首字符字母数字,其后可含 . _ -,总长 1–32。不含路径分隔符 / `..` / 空格。 */
const OFFICE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;

/** 仅校验字符规则(不含保留名 default 判定)。 */
export function isValidOfficeName(name: string): boolean {
  return OFFICE_NAME_RE.test(name);
}

/**
 * 断言用户输入的 office 名可用作"具名办公室":非法字符 / 空 / 超长 / 含 `/`、`..` → throw;
 * 保留名 `default` 也 throw(默认办公室不用 --office,直接 falinks / falinks up)。
 */
export function assertOfficeName(name: string): void {
  if (name === DEFAULT_OFFICE) {
    throw new Error(t().officeNameReserved);
  }
  if (!isValidOfficeName(name)) {
    throw new Error(t().officeNameInvalid(name));
  }
}

/** 运行态 key 的 office 后缀:默认办公室无后缀(保证逐字节兼容),具名为 `--<office>`。 */
export function officeSuffix(office: string = DEFAULT_OFFICE): string {
  return office === DEFAULT_OFFICE ? '' : `--${office}`;
}

/**
 * 运行态 key:base(= projectKey,sha1(realpath(cwd)) 前16位) + office 后缀。
 * 默认办公室 == projectKey(cwd)(无后缀);具名 == `${projectKey}--${office}`。
 * 注:message-log 历史上用 sha1(cwd)(未 realpath)作 base,为兼容它**保留各自 base**,共享 officeSuffix。
 */
export function keyFor(cwd: string, office: string = DEFAULT_OFFICE): string {
  return projectKey(cwd) + officeSuffix(office);
}

/**
 * config 路径:默认办公室 <cwd>/falinks.config.json(不变);具名 <cwd>/.falinks/<office>.config.json。
 * (.falinks/ 目录在首次写入具名 config 时由调用方建。)
 */
export function resolveConfigPath(cwd: string, office: string = DEFAULT_OFFICE): string {
  return office === DEFAULT_OFFICE
    ? join(cwd, 'falinks.config.json')
    : join(cwd, '.falinks', `${office}.config.json`);
}

export interface OfficeEntry {
  office: string;
  configPath: string;
  running: boolean;
  port?: number;
}

/**
 * 枚举本项目所有办公室:默认(若 <cwd>/falinks.config.json 存在)+ 每个 <cwd>/.falinks/*.config.json。
 * 各自查实例档案 (cwd, office) 标注运行中/已停(仅按档案是否存在,不探活——探活留给调用方/discovery)。
 */
export function listOffices(cwd: string, root: string = runtimeDir()): OfficeEntry[] {
  const out: OfficeEntry[] = [];
  const mark = (office: string, configPath: string) => {
    const inst = readInstance(cwd, root, office);
    out.push({ office, configPath, running: !!inst, port: inst?.port });
  };

  const defConfig = resolveConfigPath(cwd, DEFAULT_OFFICE);
  if (existsSync(defConfig)) mark(DEFAULT_OFFICE, defConfig);

  let named: string[] = [];
  try {
    named = readdirSync(join(cwd, '.falinks'))
      .filter((n) => n.endsWith('.config.json'))
      .map((n) => n.slice(0, -'.config.json'.length))
      .filter((office) => office !== DEFAULT_OFFICE && isValidOfficeName(office))
      .sort();
  } catch { /* 无 .falinks/ 目录 → 没有具名办公室 */ }
  for (const office of named) mark(office, resolveConfigPath(cwd, office));

  return out;
}

import { readdirSync } from 'node:fs';

/** 可选的 CLI 类型（向导里枚举给用户选）。 */
export const CLIS = ['claude', 'codex'] as const;
export type Cli = (typeof CLIS)[number];

/** 列出 base 目录下的子目录名（用于路径补全;读失败返回空)。 */
export function fsListDirs(base: string): string[] {
  try {
    return readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * 给一个（可能不完整的）路径，返回匹配的目录建议（完整路径）。
 * listDirNames(base) 返回 base 目录下的子目录名（注入以便测试）。
 */
export function dirSuggestions(partial: string, listDirNames: (base: string) => string[]): string[] {
  let base: string;
  let prefix: string;
  if (partial === '') {
    base = '/';
    prefix = '';
  } else if (partial.endsWith('/')) {
    base = partial;
    prefix = '';
  } else {
    const i = partial.lastIndexOf('/');
    if (i < 0) {
      base = './';
      prefix = partial;
    } else {
      base = partial.slice(0, i + 1);
      prefix = partial.slice(i + 1);
    }
  }
  return listDirNames(base)
    .filter((n) => n.startsWith(prefix))
    .map((n) => base + n)
    .slice(0, 8);
}

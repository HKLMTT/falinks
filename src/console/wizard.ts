import { readdirSync } from 'node:fs';

/** 可选的 CLI 类型（向导里枚举给用户选）。 */
export const CLIS = ['claude', 'codex'] as const;
export type Cli = (typeof CLIS)[number];

/** 向导模型步的预设项。value=undefined 表示"默认(跟随 CLI 全局设置)",'custom' 哨兵=转自定义文本输入。
 *  claude 用 Claude Code 别名(跨版本稳定,[1m]=1M 上下文);codex 别名体系不同,只给 默认/自定义。 */
export interface ModelPreset { value: string | undefined; key: 'default' | 'opus1m' | 'opus' | 'sonnet1m' | 'sonnet' | 'haiku' | 'custom'; }
export function MODEL_PRESETS(cli: string): ModelPreset[] {
  const base: ModelPreset[] = [{ value: undefined, key: 'default' }];
  if (cli === 'claude') {
    base.push(
      { value: 'opus[1m]', key: 'opus1m' },
      { value: 'opus', key: 'opus' },
      { value: 'sonnet[1m]', key: 'sonnet1m' },
      { value: 'sonnet', key: 'sonnet' },
      { value: 'haiku', key: 'haiku' },
    );
  }
  base.push({ value: 'custom', key: 'custom' });
  return base;
}

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

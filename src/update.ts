/** 全局更新命令（macOS 全局安装需 sudo）。 */
export function upgradeCommand(pkg: string): string {
  return `sudo npm i -g ${pkg}`;
}

/** latest 是否比 current 新（简单 semver 数值比较，忽略预发布后缀）。 */
export function isNewer(latest: string, current: string): boolean {
  const pa = latest.split('-')[0].split('.').map((x) => Number(x) || 0);
  const pb = current.split('-')[0].split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) {
    const a = pa[i] || 0;
    const b = pb[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

/** 查 npm registry 上某包的 latest 版本；超时/出错返回 null（不打扰）。 */
export async function fetchLatest(pkg: string, timeoutMs = 2500): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j: any = await res.json();
    return typeof j.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
}

// 跨平台拷贝：src/office/web 整树 → dist/office/web。
// tsc 只编译 .ts，非 TS 资源（html/css/js/png/json…）需另行拷贝，否则发布后 /office 404。
// 纯 ESM、只用 node 内置 fs/path/url；整树照拷，不做白名单。
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src', 'office', 'web');
const dest = path.join(root, 'dist', 'office', 'web');

if (!existsSync(src)) {
  console.error(`[copy-office-web] 源目录不存在: ${src}`);
  process.exit(1);
}

// recursive cp 会自动创建 dist/office/web 及中间目录。
cpSync(src, dest, { recursive: true });
console.log(`[copy-office-web] ${src} → ${dest}`);

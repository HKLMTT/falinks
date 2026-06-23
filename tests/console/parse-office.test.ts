import { expect, test } from 'vitest';
import { parseConsoleInput } from '../../src/console/parse.js';

test('/office -> { kind: office }', () => {
  expect(parseConsoleInput('/office')).toEqual({ kind: 'office' });
});

test('/office 带多余参数仍解析为 office(noArgs 命令忽略尾随)', () => {
  // 当前约定:/office 无参;有尾随空白也按 office 处理(与 /help 一致地宽松)
  expect(parseConsoleInput('/office  ')).toEqual({ kind: 'office' });
});

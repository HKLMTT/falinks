import React, { useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import { t } from '../i18n/index.js';
import { DEFAULT_OFFICE, isValidOfficeName, type OfficeEntry } from '../core/office.js';

/** 裸 falinks 的办公室选择结果。 */
export type OfficeChoice =
  | { kind: 'open'; entry: OfficeEntry }   // 选了已有办公室(运行中→连控制台 / 已停→启动)
  | { kind: 'new' }                        // 选了「＋ 新建办公室」
  | null;                                  // Esc/Ctrl+C 取消

function officeLabel(e: OfficeEntry): string {
  if (e.office === DEFAULT_OFFICE) return e.running ? t().officeItemDefaultRunning : t().officeItemDefaultStopped;
  return e.running ? t().officeItemRunning(e.office) : t().officeItemStopped(e.office);
}

/** 办公室列表选择器:已有办公室(标运行/停)+ 末尾「＋ 新建办公室」。↑↓ 选 / Enter 确认 / Esc 取消。 */
function PickApp({ entries, onDone }: { entries: OfficeEntry[]; onDone: (c: OfficeChoice) => void }) {
  const [sel, setSel] = useState(0);
  const total = entries.length + 1; // 末尾「新建」
  useInput((char, key) => {
    if (key.escape || (key.ctrl && char === 'c')) { onDone(null); return; }
    if (key.upArrow) { setSel((s) => Math.max(0, s - 1)); return; }
    if (key.downArrow) { setSel((s) => Math.min(total - 1, s + 1)); return; }
    if (key.return) {
      if (sel === entries.length) onDone({ kind: 'new' });
      else onDone({ kind: 'open', entry: entries[sel] });
    }
  });
  return (
    <Box flexDirection="column">
      <Text bold>{t().officePickHeader}</Text>
      {entries.map((e, i) => (
        <Text key={e.office} inverse={i === sel}>{i === sel ? '▶ ' : '  '}{officeLabel(e)}</Text>
      ))}
      <Text inverse={sel === entries.length}>{sel === entries.length ? '▶ ' : '  '}{t().officeItemNew}</Text>
    </Box>
  );
}

export function runOfficePicker(entries: OfficeEntry[]): Promise<OfficeChoice> {
  return new Promise((resolve) => {
    const app = render(<PickApp entries={entries} onDone={(c) => { app.unmount(); resolve(c); }} />);
  });
}

/** 新办公室名字输入。Enter 提交合法名;Esc/Ctrl+C 取消返回 null。非法名实时标红、不允许提交。 */
function NameApp({ onDone }: { onDone: (name: string | null) => void }) {
  const [val, setVal] = useState('');
  const valid = val.length > 0 && val !== DEFAULT_OFFICE && isValidOfficeName(val);
  useInput((char, key) => {
    if (key.escape || (key.ctrl && char === 'c')) { onDone(null); return; }
    if (key.return) { if (valid) onDone(val); return; }
    if (key.backspace || key.delete) { setVal((v) => v.slice(0, -1)); return; }
    if (char && !key.ctrl && !key.meta) setVal((v) => v + char);
  });
  return (
    <Box flexDirection="column">
      <Text bold>{t().officeNamePrompt}</Text>
      <Box>
        <Text color="green">› </Text>
        <Text color={val.length === 0 || valid ? undefined : 'red'}>{val}</Text>
        <Text inverse> </Text>
      </Box>
    </Box>
  );
}

export function runOfficeNamePrompt(): Promise<string | null> {
  return new Promise((resolve) => {
    const app = render(<NameApp onDone={(n) => { app.unmount(); resolve(n); }} />);
  });
}

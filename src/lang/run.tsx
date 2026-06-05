import React, { useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import { t } from '../i18n/index.js';

type Lang = 'zh' | 'en' | 'auto';

const OPTIONS: Lang[] = ['auto', 'zh', 'en'];

function label(l: Lang): string {
  return l === 'auto' ? t().langAuto : l === 'zh' ? t().langZh : t().langEn;
}

/**
 * 语言选择器小组件：三项 auto/中文/English。
 * ↑↓ 移动、Enter 回调选中值、Esc/Ctrl+C 回调 null。当前 locale 项加 ▶ 标记。
 */
function LangApp({ current, onDone }: { current: Lang; onDone: (l: Lang | null) => void }) {
  const [sel, setSel] = useState(Math.max(0, OPTIONS.indexOf(current)));
  useInput((_char, key) => {
    if (key.escape || (key.ctrl && _char === 'c')) { onDone(null); return; }
    if (key.upArrow) { setSel((s) => Math.max(0, s - 1)); return; }
    if (key.downArrow) { setSel((s) => Math.min(OPTIONS.length - 1, s + 1)); return; }
    if (key.return) { onDone(OPTIONS[sel]); return; }
  });
  return (
    <Box flexDirection="column">
      <Text bold>{t().langPickTitle}</Text>
      {OPTIONS.map((l, i) => (
        <Text key={l} inverse={i === sel}>
          {l === current ? '▶ ' : '  '}{label(l)}
        </Text>
      ))}
    </Box>
  );
}

/** 渲染语言选择器，返回选中值；Esc/Ctrl+C 取消返回 null。 */
export function runLangPicker(current: Lang): Promise<Lang | null> {
  return new Promise((resolve) => {
    const app = render(
      <LangApp current={current} onDone={(l) => { app.unmount(); resolve(l); }} />,
    );
  });
}

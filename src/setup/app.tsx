import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { allTemplates, configFromMembers, saveTemplate, type TeamMember } from '../templates.js';

type Mode = 'pick' | 'cname' | 'crole' | 'teamname';

/** 启动时的团队选择 + 自定义团队向导。完成后回调 onDone(配置对象)。 */
export function SetupApp({ cwd, onDone }: { cwd: string; onDone: (cfg: unknown) => void }) {
  const templates = allTemplates();
  const options = [
    ...templates.map((t) => ({ kind: 'tpl' as const, t })),
    { kind: 'custom' as const },
  ];
  const [mode, setMode] = useState<Mode>('pick');
  const [sel, setSel] = useState(0);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [text, setText] = useState('');
  const [pendingName, setPendingName] = useState('');

  useInput((char, key) => {
    if (mode === 'pick') {
      if (key.upArrow) { setSel((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setSel((s) => Math.min(options.length - 1, s + 1)); return; }
      if (key.return) {
        const o = options[sel];
        if (o.kind === 'tpl') onDone(configFromMembers(o.t.members, cwd));
        else { setMode('cname'); setText(''); }
      }
      return;
    }
    if (key.return) {
      const val = text.trim();
      setText('');
      if (mode === 'cname') {
        if (!val) { if (members.length) setMode('teamname'); return; } // 空名回车=完成
        setPendingName(val); setMode('crole'); return;
      }
      if (mode === 'crole') {
        setMembers((ms) => [...ms, { name: pendingName, cli: 'claude', role: val || '员工' }]);
        setMode('cname'); return;
      }
      if (mode === 'teamname') {
        const id = (val || 'myteam').replace(/\s+/g, '-');
        saveTemplate({ id, name: val || id, members });
        onDone(configFromMembers(members, cwd));
        return;
      }
    }
    if (key.backspace || key.delete) { setText((t) => t.slice(0, -1)); return; }
    if (char && !key.ctrl && !key.meta && !key.escape && !key.tab) { setText((t) => t + char); return; }
  });

  if (mode === 'pick') {
    return (
      <Box flexDirection="column">
        <Text bold>falinks — 选择团队模板（↑↓ 选 · Enter 确认）</Text>
        {options.map((o, i) => (
          <Text key={i} inverse={i === sel}>
            {o.kind === 'tpl'
              ? `  ${o.t.name}${o.t.custom ? ' ·我的' : ''}（${o.t.members.length} 人）`
              : '  ＋ 自定义团队…'}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>自定义团队（输入名字+角色逐个加，留空名字回车=完成）</Text>
      {members.map((m, i) => (
        <Text key={i} dimColor>  {i + 1}. {m.name} — {m.role}</Text>
      ))}
      {mode === 'cname' && (
        <Text>新成员名字: <Text color="green">{text}</Text><Text inverse> </Text></Text>
      )}
      {mode === 'crole' && (
        <Text>{pendingName} 的角色/职责: <Text color="green">{text}</Text><Text inverse> </Text></Text>
      )}
      {mode === 'teamname' && (
        <Text>保存为团队模板，起个名: <Text color="green">{text}</Text><Text inverse> </Text></Text>
      )}
    </Box>
  );
}

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { allTemplates, configFromMembers, saveTemplate, type TeamMember } from '../templates.js';
import { upgradeCommand } from '../update.js';

type Mode = 'update' | 'pick' | 'cname' | 'ccli' | 'crole' | 'teamname';

const CLIS = ['claude', 'codex'] as const;

/** 选「退出去更新」时 onDone 收到的哨兵（cli.ts 据此打印更新命令并退出）。 */
export const QUIT_FOR_UPDATE = { __action: 'quit-for-update' } as const;

export interface UpdateInfo {
  latest: string;
  current: string;
  pkg: string;
}

type Option =
  | { kind: 'reuse' }
  | { kind: 'tpl'; t: ReturnType<typeof allTemplates>[number] }
  | { kind: 'custom' };

/**
 * 启动时的更新提示 + 团队选择 + 自定义团队向导。
 * 有 update 时先进入「发现新版」一屏：继续 / 退出去更新。
 * 选「继续当前团队」回调 onDone(null)（沿用现有配置，不覆盖）；选模板/自定义回调 onDone(配置对象)；
 * 选「退出去更新」回调 onDone(QUIT_FOR_UPDATE)。
 * current：当前目录已有配置的简述（如 "alice/bob"），有则作为默认第一项。
 */
export function SetupApp({
  cwd,
  current,
  update = null,
  onDone,
}: {
  cwd: string;
  current: string | null;
  update?: UpdateInfo | null;
  onDone: (cfg: unknown) => void;
}) {
  const templates = allTemplates();
  const options: Option[] = [
    ...(current ? [{ kind: 'reuse' as const }] : []),
    ...templates.map((t) => ({ kind: 'tpl' as const, t })),
    { kind: 'custom' as const },
  ];
  const [mode, setMode] = useState<Mode>(update ? 'update' : 'pick');
  const [sel, setSel] = useState(0);
  const [updSel, setUpdSel] = useState(0);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [text, setText] = useState('');
  const [pendingName, setPendingName] = useState('');
  const [pendingCli, setPendingCli] = useState<string>('claude');
  const [cliSel, setCliSel] = useState(0);

  useInput((char, key) => {
    if (mode === 'update') {
      if (key.upArrow) { setUpdSel((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setUpdSel((s) => Math.min(1, s + 1)); return; }
      if (key.return) {
        if (updSel === 0) { setMode('pick'); setSel(0); } // 继续
        else onDone(QUIT_FOR_UPDATE); // 退出去更新
      }
      return;
    }
    if (mode === 'pick') {
      if (key.upArrow) { setSel((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setSel((s) => Math.min(options.length - 1, s + 1)); return; }
      if (key.return) {
        const o = options[sel];
        if (o.kind === 'reuse') onDone(null);
        else if (o.kind === 'tpl') onDone(configFromMembers(o.t.members, cwd));
        else { setMode('cname'); setText(''); }
      }
      return;
    }
    if (mode === 'ccli') {
      if (key.upArrow) { setCliSel((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setCliSel((s) => Math.min(CLIS.length - 1, s + 1)); return; }
      if (key.return) { setPendingCli(CLIS[cliSel]); setMode('crole'); }
      return;
    }
    if (key.return) {
      const val = text.trim();
      setText('');
      if (mode === 'cname') {
        if (!val) { if (members.length) setMode('teamname'); return; } // 空名回车=完成
        setPendingName(val); setCliSel(0); setMode('ccli'); return;
      }
      if (mode === 'crole') {
        setMembers((ms) => [...ms, { name: pendingName, cli: pendingCli, role: val || '员工' }]);
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

  if (mode === 'update' && update) {
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">🆕 发现新版 {update.latest}（当前 v{update.current}）</Text>
        <Text dimColor>↑↓ 选 · Enter 确认</Text>
        <Text inverse={updSel === 0}>  ▶ 继续使用当前版本</Text>
        <Text inverse={updSel === 1}>  ⤓ 退出去更新（{upgradeCommand(update.pkg)}）</Text>
      </Box>
    );
  }

  if (mode === 'pick') {
    return (
      <Box flexDirection="column">
        <Text bold>falinks — 选择团队（↑↓ 选 · Enter 确认）</Text>
        {options.map((o, i) => (
          <Text key={i} inverse={i === sel}>
            {o.kind === 'reuse'
              ? `  ▶ 继续当前团队（${current}）`
              : o.kind === 'tpl'
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
        <Text key={i} dimColor>  {i + 1}. {m.name}（{m.cli}） — {m.role}</Text>
      ))}
      {mode === 'cname' && (
        <Text>新成员名字: <Text color="green">{text}</Text><Text inverse> </Text></Text>
      )}
      {mode === 'ccli' && (
        <Box flexDirection="column">
          <Text>{pendingName} 用哪个 CLI?（↑↓ 选 · Enter 确认）</Text>
          {CLIS.map((c, i) => (
            <Text key={c} inverse={i === cliSel}>  {c}</Text>
          ))}
        </Box>
      )}
      {mode === 'crole' && (
        <Text>{pendingName}（{pendingCli}） 的角色/职责: <Text color="green">{text}</Text><Text inverse> </Text></Text>
      )}
      {mode === 'teamname' && (
        <Text>保存为团队模板，起个名: <Text color="green">{text}</Text><Text inverse> </Text></Text>
      )}
    </Box>
  );
}

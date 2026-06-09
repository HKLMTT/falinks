import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { allTemplates, configFromMembers, saveTemplate, type TeamMember } from '../templates.js';
import { dirSuggestions, fsListDirs } from '../console/wizard.js';
import { upgradeCommand } from '../update.js';
import { t } from '../i18n/index.js';

type Mode = 'update' | 'pick' | 'cname' | 'ccli' | 'crole' | 'ccwd' | 'teamname';

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
  const [pendingRole, setPendingRole] = useState('');
  const [cliSel, setCliSel] = useState(0);
  const [cwdPath, setCwdPath] = useState(cwd);
  const [cwdSel, setCwdSel] = useState(0);

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
    if (mode === 'ccwd') {
      // 工作目录选择(带目录补全,仿 /add 向导):↑↓ 选建议 · Tab 补全 · Enter 确认 · 退格删 · 打字编辑
      const sugs = dirSuggestions(cwdPath, fsListDirs);
      if (key.upArrow) { setCwdSel((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setCwdSel((s) => Math.min(Math.max(0, sugs.length - 1), s + 1)); return; }
      if (key.tab) { if (sugs.length) { setCwdPath(sugs[Math.min(cwdSel, sugs.length - 1)] + '/'); setCwdSel(0); } return; }
      if (key.return) {
        setMembers((ms) => [...ms, { name: pendingName, cli: pendingCli, role: pendingRole, cwd: cwdPath.trim() || cwd }]);
        setMode('cname'); return;
      }
      if (key.backspace || key.delete) { setCwdPath((p) => p.slice(0, -1)); setCwdSel(0); return; }
      if (char && !key.ctrl && !key.meta && !key.escape) { setCwdPath((p) => p + char); setCwdSel(0); return; }
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
        setPendingRole(val || t().setupDefaultRole); setCwdPath(cwd); setCwdSel(0); setMode('ccwd'); return;
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
        <Text bold color="yellow">{t().setupUpdateFound(update.latest, update.current)}</Text>
        <Text dimColor>{t().setupChooseKeys}</Text>
        <Text inverse={updSel === 0}>{t().setupKeepCurrentVersion}</Text>
        <Text inverse={updSel === 1}>{t().setupQuitForUpdate(upgradeCommand(update.pkg))}</Text>
      </Box>
    );
  }

  if (mode === 'pick') {
    return (
      <Box flexDirection="column">
        <Text bold>{t().setupChooseTeam}</Text>
        {options.map((o, i) => (
          <Text key={i} inverse={i === sel}>
            {o.kind === 'reuse'
              ? t().setupReuseTeam(current as string)
              : o.kind === 'tpl'
                ? t().setupTplLabel(o.t.name, o.t.custom ? t().setupTplMine : '', o.t.members.length)
                : t().setupCustomTeam}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>{t().setupCustomTitle}</Text>
      {members.map((m, i) => (
        <Text key={i} dimColor>{t().setupMemberLine(i + 1, m.name, m.cli, m.role)}</Text>
      ))}
      {mode === 'cname' && (
        <Text>{t().setupNewMemberName}<Text color="green">{text}</Text><Text inverse> </Text></Text>
      )}
      {mode === 'ccli' && (
        <Box flexDirection="column">
          <Text>{t().setupWhichCli(pendingName)}</Text>
          {CLIS.map((c, i) => (
            <Text key={c} inverse={i === cliSel}>  {c}</Text>
          ))}
        </Box>
      )}
      {mode === 'crole' && (
        <Text>{t().setupRolePrompt(pendingName, pendingCli)}<Text color="green">{text}</Text><Text inverse> </Text></Text>
      )}
      {mode === 'ccwd' && (
        <Box flexDirection="column">
          <Text>{t().setupCwdPrompt(pendingName)}<Text color="green">{cwdPath}</Text><Text inverse> </Text></Text>
          {dirSuggestions(cwdPath, fsListDirs).map((d, i) => (
            <Text key={d} inverse={i === cwdSel} dimColor={i !== cwdSel}>  {d}</Text>
          ))}
        </Box>
      )}
      {mode === 'teamname' && (
        <Text>{t().setupSaveTeamName}<Text color="green">{text}</Text><Text inverse> </Text></Text>
      )}
    </Box>
  );
}

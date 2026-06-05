import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeDir } from './runtime.js';
import { t } from './i18n/index.js';

export interface TeamMember {
  name: string;
  cli: string; // claude | codex
  role: string; // 职责描述（用于花名册标签 + 派生 bootstrap）
}

export interface TeamTemplate {
  id: string;
  name: string; // 显示名
  members: TeamMember[];
  custom?: boolean; // 用户自定义保存的
}

/** 由职责派生 agent 的 bootstrap（统一加省 token 风格）。 */
export function bootstrapForRole(role: string): string {
  return t().roleBootstrap(role);
}

/** 预设团队模板（实时取词：name/role 调用时按当前语言取）。 */
export function presetTeams(): TeamTemplate[] {
  return [
    { id: 'solo', name: t().tplSoloName, members: [{ name: 'alice', cli: 'claude', role: t().tplSoloRole }] },
    {
      id: 'pair',
      name: t().tplPairName,
      members: [
        { name: 'dev', cli: 'claude', role: t().tplPairDev },
        { name: 'reviewer', cli: 'claude', role: t().tplPairReviewer },
      ],
    },
    {
      id: 'fullstack',
      name: t().tplFullstackName,
      members: [
        { name: 'lead', cli: 'claude', role: t().tplFullstackLead },
        { name: 'frontend', cli: 'claude', role: t().tplFullstackFrontend },
        { name: 'backend', cli: 'claude', role: t().tplFullstackBackend },
        { name: 'qa', cli: 'claude', role: t().tplFullstackQa },
      ],
    },
    {
      id: 'research',
      name: t().tplResearchName,
      members: [
        { name: 'researcher', cli: 'claude', role: t().tplResearchResearcher },
        { name: 'writer', cli: 'claude', role: t().tplResearchWriter },
        { name: 'editor', cli: 'claude', role: t().tplResearchEditor },
      ],
    },
  ];
}

/** 由一组成员生成 falinks 配置(所有员工工作目录=cwd)。busPort 不写:缺省自动分配,多实例不冲突。 */
export function configFromMembers(members: TeamMember[], cwd: string) {
  return {
    agents: members.map((m) => ({ name: m.name, cli: m.cli, cwd, role: m.role, bootstrap: bootstrapForRole(m.role) })),
    routes: {},
  };
}

function templatesDir(): string {
  return join(runtimeDir(), 'templates');
}

/** 读取用户保存的自定义模板。 */
export function loadUserTemplates(): TeamTemplate[] {
  try {
    return readdirSync(templatesDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ ...(JSON.parse(readFileSync(join(templatesDir(), f), 'utf8')) as TeamTemplate), custom: true }));
  } catch {
    return [];
  }
}

/** 预设 + 用户自定义。 */
export function allTemplates(): TeamTemplate[] {
  return [...presetTeams(), ...loadUserTemplates()];
}

/** 保存一个自定义模板到 ~/.falinks/templates/<id>.json。 */
export function saveTemplate(t: TeamTemplate): void {
  mkdirSync(templatesDir(), { recursive: true });
  writeFileSync(join(templatesDir(), `${t.id}.json`), JSON.stringify({ ...t, custom: true }, null, 2));
}

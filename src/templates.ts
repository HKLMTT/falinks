import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeDir } from './runtime.js';

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
  return `你的职责：${role}。风格简练，少废话。`;
}

/** 预设团队模板。 */
export const PRESET_TEMPLATES: TeamTemplate[] = [
  { id: 'solo', name: '单人助手', members: [{ name: 'alice', cli: 'claude', role: '通用助手' }] },
  {
    id: 'pair',
    name: '结对编程（开发者+审查者）',
    members: [
      { name: 'dev', cli: 'claude', role: '开发者，负责写代码实现需求' },
      { name: 'reviewer', cli: 'claude', role: '审查者，负责审查 dev 的代码、挑问题提改进' },
    ],
  },
  {
    id: 'fullstack',
    name: '全栈小组（组长+前端+后端+测试）',
    members: [
      { name: 'lead', cli: 'claude', role: '组长，统筹任务并分配给前端/后端/测试' },
      { name: 'frontend', cli: 'claude', role: '前端开发' },
      { name: 'backend', cli: 'claude', role: '后端开发' },
      { name: 'qa', cli: 'claude', role: '测试与质量' },
    ],
  },
  {
    id: 'research',
    name: '调研组（调研员+撰写+审校）',
    members: [
      { name: 'researcher', cli: 'claude', role: '调研员，负责查证与资料收集' },
      { name: 'writer', cli: 'claude', role: '撰写，把调研整理成文' },
      { name: 'editor', cli: 'claude', role: '审校，审查并润色 writer 的产出' },
    ],
  },
];

/** 由一组成员生成 falinks 配置（所有员工工作目录=cwd）。 */
export function configFromMembers(members: TeamMember[], cwd: string, busPort = 7878) {
  return {
    busPort,
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
  return [...PRESET_TEMPLATES, ...loadUserTemplates()];
}

/** 保存一个自定义模板到 ~/.falinks/templates/<id>.json。 */
export function saveTemplate(t: TeamTemplate): void {
  mkdirSync(templatesDir(), { recursive: true });
  writeFileSync(join(templatesDir(), `${t.id}.json`), JSON.stringify({ ...t, custom: true }, null, 2));
}

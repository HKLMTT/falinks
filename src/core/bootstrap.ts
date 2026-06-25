import { t, type Locale } from '../i18n/index.js';
import { zh } from '../i18n/zh.js';
import { en } from '../i18n/en.js';

/** composeBootstrap 的输入 agent(子集:身份 + lead/assistant 标记 + 角色派生 bootstrap)。 */
export interface BootstrapAgent {
  name: string;
  role?: string;
  lead?: boolean;
  assistant?: boolean;
  bootstrap?: string;
}

/** composeBootstrap 的可选项:把磁盘 IO 的产物(lead 项目状态档)与 locale 作为参数传入,函数保持纯。 */
export interface ComposeBootstrapOpts {
  /** lead 的「项目状态档」续接文本(由 caller 从磁盘读出后传入);仅 lead 且非空时拼接。 */
  leadStateDoc?: string;
  /** 取词语言;缺省=当前全局 locale(t())。显式传入便于单测两语言而不改全局状态。 */
  locale?: Locale;
}

/**
 * 组装最终 bootstrap —— **纯函数,可单测、无副作用、无磁盘 IO**:
 *   houseRules + identity + roleBootstrap
 *   + (agent.assistant → assistantRules)
 *   + (agent.lead → coordinatorRules + (团队有 assistant → coordinatorAssistAddendum) + (leadStateDoc → 项目状态段))
 * 磁盘读取(loadLeadState)留在 caller(index.ts),读出的 doc 经 opts.leadStateDoc 传入。
 *
 * @param agent 目标 agent
 * @param cfg   本团队配置(仅用 cfg.agents 的 assistant 标记判断是否给 lead 追加 addendum)
 * @param opts  leadStateDoc / locale(均可选)
 */
export function composeBootstrap(
  agent: BootstrapAgent,
  cfg: { agents: ReadonlyArray<{ assistant?: boolean }> },
  opts?: ComposeBootstrapOpts,
): string {
  const T = opts?.locale === 'en' ? en : opts?.locale === 'zh' ? zh : t();
  let s = `${T.houseRules}\n${T.identityLine(agent.name, agent.role)}${agent.bootstrap ?? ''}`;
  if (agent.assistant) {
    // 助理:执行不决策(与 coordinatorRules 互斥位——助理不会是 lead)。
    s += `\n${T.assistantRules}`;
  }
  if (agent.lead) {
    s += `\n${T.coordinatorRules}`;
    // 本团队配有助理 → 追加"把体力活分给助理"的话;无助理团队(如 fullstack)的 lead 不加。
    if (cfg.agents.some((x) => x.assistant)) s += `\n${T.coordinatorAssistAddendum}`;
    // 项目状态档续接(caller 已从磁盘读出并传入);只有 lead 且非空时拼接。
    if (opts?.leadStateDoc) s += `\n【项目状态(续接用,这是你上一段会话沉淀的记忆)】\n${opts.leadStateDoc}`;
  }
  return s;
}

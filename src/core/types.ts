export type AgentName = string;

export type AgentStatus =
  | 'launching' // 已建窗、CLI 启动中，尚未就绪
  | 'idle'      // 就绪、空闲，可接收注入
  | 'busy'      // 已注入一条、正在处理
  | 'stuck'     // 标 busy 后超时未 idle
  | 'dead';     // 窗口关闭 / 注入失败 / 连接断开

export interface Message {
  id: string;
  from: AgentName;
  to: AgentName;
  body: string;
  ts: number;
}

export interface AgentRuntime {
  name: AgentName;
  role?: string;
  status: AgentStatus;
  sessionId?: string; // iTerm session id（register 时填入）
  inbox: Message[];
}

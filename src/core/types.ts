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
  thread?: string; // 服务端派生的会话线程 id（仅在配置了 Guards 时设置）
  canceled?: boolean; // 排队期间被老板撤销（从未投递）;流水保留记录,历史里标"已取消"
  urgent?: boolean; // boss 插队直送:跳过队列直接注入(忙时进 CLI 输入缓冲);排队消息被提升直送时事后补标
}

export interface AgentRuntime {
  name: AgentName;
  role?: string;
  status: AgentStatus;
  sessionId?: string; // iTerm session id（register 时填入）
  inbox: Message[];
  handling?: string; // 当前正在处理的消息的 thread
  handlingFrom?: AgentName; // 当前正在处理的消息的发信人（决定回复是否续用同一 thread）
  virtual?: boolean; // 虚拟成员（如 boss）：无窗口，消息只入日志不注入
  lead?: boolean; // 组长/协调者（全队唯一）：花名册显示标记;协调者工作法注入对象
  assistant?: boolean; // 助理(对称 lead):执行不决策;花名册/可视化可加角标
  lastMcpAt?: number; // 最近一次该员工经 MCP 调用任意工具的时刻(服务端事实;失联检测的核心信号)
  lastMcpHttpAt?: number; // 最近一次命中该员工 MCP 端点的 HTTP 请求(CLI 启动 initialize 即有;只用于告警文案分流)
  unresponsive?: boolean; // 失联嫌疑(报到超时/有活无声):花名册 ⚠;收到任意 MCP 调用自愈
  unresponsiveRule?: 'register-timeout' | 'mute'; // 触发 ⚠ 的规则(决定警告文案:未报到 vs 有活无声)
  muteStreak?: number; // 连续"有活无声"次数(投递后自动降闲且零 MCP 调用);touchMcp 清零
  holding?: boolean; // /clear 等保护窗口(hold()):pane 正在清空,禁直送(urgent/promote 退化排队);register/onIdle/markLaunching 清除
}

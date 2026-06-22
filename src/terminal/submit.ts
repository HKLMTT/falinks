// 终端注入的"可靠提交"逻辑:纯函数,I/O 经依赖注入,便于单测(不碰 osascript)。

/**
 * 判断注入的正文是否仍滞留在底部输入框(= 提交回车被 TUI 吞掉、消息没发出去)。
 * 取正文末尾一段(去空白+去边框)作探针,在屏幕最后 4 行(同样去空白+去边框拼接)里找。
 * - TUI 把输入框钉在底部,正文末尾恒落在框底内容行(底部往上 ~2-3 行,含底边框+提示行之上)→ 4 行窗口必覆盖;
 * - 已提交时该处变空框,正文上移成对话回显——回显在顶边框之上(≥5 行),落在窗口外,故不误判。
 * 去空白:抗硬折行(行中断不引入伪空格);去边框(U+2500–U+257F 制表符):抗输入框 `│ … │` 把正文逐行夹断。
 * 空正文恒 false(无需验证)。
 */
export function inputBoxRetainsBody(screen: string, body: string): boolean {
  const strip = (s: string) => s.replace(/[\s─-╿]/g, ''); // 去空白 + 去制表/边框字符
  const b = strip(body);
  if (!b) return false;
  const probe = b.length > 24 ? b.slice(-24) : b; // 末尾片段够独特;短正文整体比
  const lines = screen.split('\n').filter((l) => l.trim() !== '');
  const bottom = strip(lines.slice(-4).join(''));
  return bottom.includes(probe);
}

/**
 * 闭环提交:发回车 → 读屏验证正文是否还在输入框 → 没发出去就重发,最多 maxAttempts 次。
 * 纯逻辑,I/O 经 deps 注入(便于单测)。空正文(信任对话/盲回车等)发一次即返回,不验证。
 * readScreen 抛错(读屏失败)按"已提交"处理,不无谓重发。
 */
export async function submitWithVerify(deps: {
  enter: () => Promise<void>;          // 发一个提交回车
  readScreen: () => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  body: string;
  settleMs: number;
  verifyMs: number;
  maxAttempts: number;
}): Promise<void> {
  for (let i = 0; i < deps.maxAttempts; i++) {
    await deps.sleep(deps.settleMs);
    await deps.enter();
    if (!deps.body.trim()) return;     // 空提交:无正文可验证
    await deps.sleep(deps.verifyMs);
    let screen = '';
    try { screen = await deps.readScreen(); } catch { return; } // 读屏失败:不重发,避免误投
    if (!inputBoxRetainsBody(screen, deps.body)) return;        // 已离开输入框 = 提交成功
  }
}

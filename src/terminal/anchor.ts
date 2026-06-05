/**
 * 选一个"活着的"分屏锚点。
 *
 * 根因背景:新员工的 pane 从锚点 pane 向右分裂(splitFrom),锚点找不到会直接抛
 * "anchor not found"。控制台跟踪的 lastRight(上次新建的右侧 pane)在该 pane 被关/被删后
 * 无人重置,会变成指向已死 pane 的野指针——此后每次 /add 的 splitFrom 都抛异常、永远失败,
 * 只能重开。这里让锚点自愈:首选 preferred(lastRight),它已关闭就回退到 fallback
 * (控制台 pane,整个会话期间一定活着)。探测异常也按"已死"处理,绝不让 add 崩。
 */
export async function chooseAnchor(
  preferred: string,
  fallback: string,
  paneExists: (sid: string) => Promise<boolean>,
): Promise<string> {
  if (preferred === fallback) return fallback;
  try {
    return (await paneExists(preferred)) ? preferred : fallback;
  } catch {
    return fallback;
  }
}

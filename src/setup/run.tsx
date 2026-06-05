import React from 'react';
import { render } from 'ink';
import { SetupApp, type UpdateInfo } from './app.js';

export { QUIT_FOR_UPDATE } from './app.js';

/**
 * 渲染启动选择向导。
 * update：有新版时先弹「发现新版」一屏（继续 / 退出去更新）。
 * current：当前目录已有配置的简述（员工名），有则提供"继续当前团队"默认项。
 * 返回 null 表示沿用现有配置；返回 QUIT_FOR_UPDATE 表示用户选了退出去更新；否则返回新的 falinks 配置对象。
 */
export function runSetup(cwd: string, current: string | null, update: UpdateInfo | null = null): Promise<unknown> {
  return new Promise((resolve) => {
    const app = render(
      <SetupApp cwd={cwd} current={current} update={update} onDone={(cfg) => { app.unmount(); resolve(cfg); }} />,
    );
  });
}

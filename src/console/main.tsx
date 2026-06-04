import React from 'react';
import { render } from 'ink';
import { readFileSync } from 'node:fs';
import { App } from './app.js';
import { runtimePath } from '../runtime.js';

function runtimePort(): number {
  try {
    return JSON.parse(readFileSync(runtimePath(), 'utf8')).port;
  } catch {
    console.error('找不到 falinks 运行时状态 —— `falinks up` 在运行吗？');
    process.exit(1);
  }
}

render(<App port={runtimePort()} />);

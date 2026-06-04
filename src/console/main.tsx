import React from 'react';
import { render } from 'ink';
import { readFileSync } from 'node:fs';
import { App } from './app.js';

function runtimePort(): number {
  try {
    return JSON.parse(readFileSync('.dagent-runtime.json', 'utf8')).port;
  } catch {
    console.error('找不到 .dagent-runtime.json —— dagent up 在运行吗？');
    process.exit(1);
  }
}

render(<App port={runtimePort()} />);

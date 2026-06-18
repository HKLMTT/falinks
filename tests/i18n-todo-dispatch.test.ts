// tests/i18n-todo-dispatch.test.ts
import { expect, test } from 'vitest';
import { zh } from '../src/i18n/zh.js';
import { en } from '../src/i18n/en.js';

test('zh 下发:角色锚点始终在,全新会话句仅非重发时出现', () => {
  const fresh = zh.todoDispatchMsg(1, 1, 3, '做X', false);
  const resend = zh.todoDispatchMsg(1, 1, 3, '做X', true);
  expect(fresh).toContain('组长');
  expect(resend).toContain('组长');        // 重发也要带角色锚点(防 lead 上下文膨胀忘角色)
  expect(fresh).toContain('全新会话');
  expect(resend).not.toContain('全新会话'); // 重发时员工没被重新清,不能谎称全新
});

test('en 下发:角色锚点始终在,全新会话句仅非重发时出现', () => {
  const fresh = en.todoDispatchMsg(1, 1, 3, 'do X', false);
  const resend = en.todoDispatchMsg(1, 1, 3, 'do X', true);
  expect(fresh).toContain('lead');
  expect(resend).toContain('lead');
  expect(fresh).toContain('brand-new');
  expect(resend).not.toContain('brand-new');
});

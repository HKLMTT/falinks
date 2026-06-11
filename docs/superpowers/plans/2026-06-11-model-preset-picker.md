# /add 向导模型预设选择器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 向导模型步改为预设选择器(claude 七项/codex 两项)+「自定义…」文本兜底。

**Architecture:** `MODEL_PRESETS(cli)` 纯函数进 wizard.ts(可单测);app.tsx 的 model 步改选择态 + 新增 model-custom 文本子步;i18n 预设描述标签。

**Tech Stack:** TypeScript ESM + Ink,vitest。门槛:全项目 `npx tsc --noEmit` + `npm test`,交付 `npm run build`。

**Spec:** `docs/superpowers/specs/2026-06-11-model-preset-picker-design.md`

---

### Task 1: 全部实现(单任务,改动面 4 文件)

**Files:**
- Modify: `src/console/wizard.ts`、`src/console/app.tsx`、`src/i18n/zh.ts`、`src/i18n/en.ts`
- Test: `tests/console/wizard.test.ts`(追加)

- [ ] **Step 1: 失败测试**(tests/console/wizard.test.ts 追加;先读该文件 harness)

```ts
test('MODEL_PRESETS:claude 七项,首项默认(undefined),末项自定义哨兵', () => {
  const p = MODEL_PRESETS('claude');
  expect(p.length).toBe(7);
  expect(p[0].value).toBeUndefined();
  expect(p.slice(1, 6).map((x) => x.value)).toEqual(['opus[1m]', 'opus', 'sonnet[1m]', 'sonnet', 'haiku']);
  expect(p[6].value).toBe('custom');
});

test('MODEL_PRESETS:codex 仅 默认+自定义', () => {
  const p = MODEL_PRESETS('codex');
  expect(p.map((x) => x.value)).toEqual([undefined, 'custom']);
});
```

- [ ] **Step 2: 实现**

① `src/console/wizard.ts`(CLIS 旁):

```ts
/** 向导模型步的预设项。value=undefined 表示"默认(跟随 CLI 全局设置)",'custom' 哨兵=转自定义文本输入。
 *  claude 用 Claude Code 别名(跨版本稳定,[1m]=1M 上下文);codex 别名体系不同,只给 默认/自定义。 */
export interface ModelPreset { value: string | undefined; key: 'default' | 'opus1m' | 'opus' | 'sonnet1m' | 'sonnet' | 'haiku' | 'custom'; }
export function MODEL_PRESETS(cli: string): ModelPreset[] {
  const base: ModelPreset[] = [{ value: undefined, key: 'default' }];
  if (cli === 'claude') {
    base.push(
      { value: 'opus[1m]', key: 'opus1m' },
      { value: 'opus', key: 'opus' },
      { value: 'sonnet[1m]', key: 'sonnet1m' },
      { value: 'sonnet', key: 'sonnet' },
      { value: 'haiku', key: 'haiku' },
    );
  }
  base.push({ value: 'custom', key: 'custom' });
  return base;
}
```

② `src/console/app.tsx`:

- `WizardState` model 步改两态:

```ts
  | { name: string; step: 'model'; cli: string; sel: number }
  | { name: string; step: 'model-custom'; cli: string; modelText: string }
```

- 按键状态机:cli 步 enter/tab → `{ step: 'model', cli, sel: 0 }`;model 步 up/down 在 `MODEL_PRESETS(wizard.cli)` 范围内移动,enter/tab:选中项 `value === 'custom'` → `{ step: 'model-custom', cli, modelText: '' }`;否则 → role 步(`model: 选中项.value`);model-custom 步沿用原 modelText 输入逻辑(enter → role 步 `model: trim() || undefined`,backspace/text 同原);
- 渲染:model 步列表渲染(同 cli 步 inverse 高亮),每项显示 `value ?? '(默认)'` + i18n 描述;model-custom 步沿用原输入渲染(标题用 wizardModelSuffix 原文案、hint 用 wizardModelHint);
- 所有新增行沿用 `wrap="truncate-end"`(残影修复的约束)。

③ i18n(zh;en 对应翻译,`en: typeof zh` 兜底):

```ts
  wizardModelPickSuffix: ' — 选模型（↑↓ 选 · Enter 确认 · Esc 取消）',
  wizardModelPresets: {
    default: '默认（跟随 CLI 全局设置）',
    opus1m: 'Opus 4.8 · 1M 上下文',
    opus: 'Opus 4.8',
    sonnet1m: 'Sonnet 4.6 · 1M 上下文',
    sonnet: 'Sonnet 4.6',
    haiku: 'Haiku 4.5 · 快/省',
    custom: '自定义…（手动输入模型名）',
  } as Record<string, string>,
```

(`wizardModelSuffix`/`wizardModelHint` 保留给 model-custom 子步。)

- [ ] **Step 3: 门槛**:`npx vitest run tests/console/ tests/i18n.test.ts && npx tsc --noEmit && npm test && npm run build` 全绿。

- [ ] **Step 4: Commit**

```bash
git add src/console/wizard.ts src/console/app.tsx src/i18n/zh.ts src/i18n/en.ts tests/console/wizard.test.ts
git commit -m "feat(console): /add 向导模型步改预设选择器(claude 七项/codex 两项)+ 自定义兜底"
```

## Self-Review:spec 全覆盖(七项/codex 两项/自定义兜底/别名/⚠ 兜底无需改动);无占位;类型一致(ModelPreset.key ↔ i18n 键)。

# /add 向导模型预设选择器 — 设计文档

日期:2026-06-11
类型:UX 改进(并入 0.12.x)
背景:0.11.0 加的向导模型步是自由文本输入,用户可能不知道模型名/别名/`[1m]` 后缀写法。

## 设计

模型步从文本输入改为**预设选择器 + 自定义兜底**(交互同 cli 步:↑↓ 选、Enter 确认、Esc 取消向导):

- **claude 员工**七项:`默认(跟随 CLI 全局设置)`(首项,Enter 零成本通过)、`opus[1m]`、`opus`、`sonnet[1m]`、`sonnet`、`haiku`、`自定义…`;
- **codex 员工**两项:`默认`、`自定义…`(codex 别名体系不同,不硬造预设);
- 选「自定义…」→ 转入现有文本输入子步(行为与 0.11 的 modelText 输入一致,含 backspace/text/enter);
- 预设用 **Claude Code 别名**(非完整 id):跨版本稳定(别名指向当前最新),配置可读;
- 写入配置/透传链的就是别名字符串,下游零改动;选错模型仍有 A-1 ⚠ 90s 兜底。

## 实现要点

- `src/console/wizard.ts`:加 `MODEL_PRESETS(cli)` 纯函数返回 `{ value: string | undefined; labelKey }[]`(undefined=默认;'custom' 哨兵);可单测;
- `src/console/app.tsx`:`WizardState` 的 model 步改为 `{ sel }` 选择态,新增 `model-custom` 文本子步;按键状态机与渲染(列表渲染同 cli 步,标签 = `value — 描述`);role 步入参不变(model?: string);
- `src/i18n/zh.ts`/`en.ts`:`wizardModelSuffix` 改提示词(↑↓ 选);各预设的描述标签(`wizardModelPresets` 记录:default/opus1m/opus/sonnet1m/sonnet/haiku/custom);`wizardModelHint` 移到自定义子步显示(保留 [1m] 说明);
- 测试:`tests/console/wizard.test.ts` 加 MODEL_PRESETS 用例(claude 7 项、codex 2 项、首项 default、末项 custom);向导状态机依赖 app-e2e 回归 + tsc。

## 有意不做

- 不动 `falinks.config.json` 的 model 字段语义(仍是任意字符串);
- 不做模型可用性探测(选错由 ⚠ 兜底);
- 初始建队向导(setup)仍不带模型步(与 0.11 决策一致)。

import { expect, test } from 'vitest';
import { parseConsoleInput, lastReplyTarget } from '../../src/console/parse.js';

test('@name message -> say', () => {
  expect(parseConsoleInput('@alice 在吗')).toEqual({ kind: 'say', to: 'alice', message: '在吗' });
});

test('@all message -> broadcast', () => {
  expect(parseConsoleInput('@all 全体开会')).toEqual({ kind: 'broadcast', message: '全体开会' });
});

test('plain text -> reply (回复上次目标,不再群发)', () => {
  expect(parseConsoleInput('继续')).toEqual({ kind: 'reply', message: '继续' });
});

test('lastReplyTarget: boss 最近发给谁就是谁', () => {
  const log = [
    { from: 'boss', to: 'lead' },
    { from: 'lead', to: 'boss' },
    { from: 'boss', to: 'qa' },
  ];
  expect(lastReplyTarget(log)).toBe('qa');
});

test('lastReplyTarget: 最近一条是别人发给 boss,则目标=发信人', () => {
  const log = [
    { from: 'boss', to: 'lead' },
    { from: 'frontend', to: 'boss' },
  ];
  expect(lastReplyTarget(log)).toBe('frontend');
});

test('lastReplyTarget: 不沾 boss 的消息忽略;无相关返回 null', () => {
  expect(lastReplyTarget([{ from: 'a', to: 'b' }])).toBeNull();
  expect(lastReplyTarget([])).toBeNull();
});

test('/clear 不带名 -> 全员清', () => {
  expect(parseConsoleInput('/clear')).toEqual({ kind: 'clear', name: undefined });
});

test('/clear name -> 指定员工(允许 @ 前缀)', () => {
  expect(parseConsoleInput('/clear lead')).toEqual({ kind: 'clear', name: 'lead' });
  expect(parseConsoleInput('/clear @lead')).toEqual({ kind: 'clear', name: 'lead' });
});

test('/add name cli cwd -> add', () => {
  expect(parseConsoleInput('/add carol claude /tmp/c')).toEqual({
    kind: 'add', spec: { name: 'carol', cli: 'claude', cwd: '/tmp/c' },
  });
});

test('/remove name -> remove', () => {
  expect(parseConsoleInput('/remove bob')).toEqual({ kind: 'remove', name: 'bob' });
  expect(parseConsoleInput('/remove @bob')).toEqual({ kind: 'remove', name: 'bob' });
});

test('/help -> help', () => {
  expect(parseConsoleInput('/help').kind).toBe('help');
});

test('/add name (one arg) -> add-start (wizard)', () => {
  expect(parseConsoleInput('/add carol')).toEqual({ kind: 'add-start', name: 'carol' });
});

test('/add with two args -> error', () => {
  expect(parseConsoleInput('/add carol claude').kind).toBe('error');
});

test('/lang (no args) -> lang-start', () => {
  expect(parseConsoleInput('/lang')).toEqual({ kind: 'lang-start' });
});

test('/lang with arg -> error (no args accepted)', () => {
  expect(parseConsoleInput('/lang xx').kind).toBe('error');
});

test('/lead (no args) -> lead-start', () => {
  expect(parseConsoleInput('/lead')).toEqual({ kind: 'lead-start' });
});

test('/lead with arg -> error (no args accepted)', () => {
  expect(parseConsoleInput('/lead bob').kind).toBe('error');
});

// 回归:图片占位 [图片N] 开头的输入是"回复",不是命令。
// (修 bug:粘贴图片展开成 /var/...png 后若先展开再解析,会被当成命令。现在用原始输入判命令。)
test('[图片N] 开头按回复处理(不被当命令);命令判定基于原始输入而非展开后的 /路径', () => {
  expect(parseConsoleInput('[图片1]')).toEqual({ kind: 'reply', message: '[图片1]' });
  expect(parseConsoleInput('[图片1] 看这个')).toEqual({ kind: 'reply', message: '[图片1] 看这个' });
  // 路径文本本身也不再被当命令(parse 的路径守卫;另一入口:iTerm 原生粘贴直接给出 /var/... 文本)
  expect(parseConsoleInput('/var/folders/x/clip.png 看这个').kind).toBe('reply');
});

test('empty input -> noop', () => {
  expect(parseConsoleInput('   ').kind).toBe('noop');
});

test('/todo add 取原始余文(多行与空格保留)', () => {
  expect(parseConsoleInput('/todo add 跑全量回归\n再出报告')).toEqual({ kind: 'todo', op: 'add', body: '跑全量回归\n再出报告' });
});

test('/todo 各子命令', () => {
  expect(parseConsoleInput('/todo list')).toEqual({ kind: 'todo', op: 'list' });
  expect(parseConsoleInput('/todo rm 3')).toEqual({ kind: 'todo', op: 'rm', seq: 3 });
  expect(parseConsoleInput('/todo clear')).toEqual({ kind: 'todo', op: 'clear' });
  expect(parseConsoleInput('/todo start')).toEqual({ kind: 'todo', op: 'start' });
  expect(parseConsoleInput('/todo start 5')).toEqual({ kind: 'todo', op: 'start', n: 5 });
  expect(parseConsoleInput('/todo stop')).toEqual({ kind: 'todo', op: 'stop' });
  expect(parseConsoleInput('/todo resume')).toEqual({ kind: 'todo', op: 'resume' });
});

test('/todo 参数校验错误', () => {
  expect(parseConsoleInput('/todo')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo add')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo add   ')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo rm x')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo start 0')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo start 2.5')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo bogus')).toMatchObject({ kind: 'error' });
});

test('parses /restart with optional fresh flag', () => {
  expect(parseConsoleInput('/restart lead')).toEqual({ kind: 'restart', name: 'lead', fresh: false });
  expect(parseConsoleInput('/restart @lead fresh')).toEqual({ kind: 'restart', name: 'lead', fresh: true });
  expect(parseConsoleInput('/restart')).toMatchObject({ kind: 'error' });
});

test('以路径开头的文本不当命令(粘贴文件路径/绝对路径)', () => {
  expect(parseConsoleInput('/var/folders/0s/x_00000gp/T/falinks-clip-1.png 看下这张图')).toEqual({ kind: 'reply', message: '/var/folders/0s/x_00000gp/T/falinks-clip-1.png 看下这张图' });
  expect(parseConsoleInput('/a/b')).toEqual({ kind: 'reply', message: '/a/b' });
  expect(parseConsoleInput('/bogus')).toMatchObject({ kind: 'error' }); // 单词未知命令仍报错
});

test('! 前缀:!@名字 → urgent say', () => {
  expect(parseConsoleInput('!@lead 改方向')).toEqual({ kind: 'say', to: 'lead', message: '改方向', urgent: true });
});

test('! 前缀:!纯文本 → urgent reply', () => {
  expect(parseConsoleInput('!停下先别动')).toEqual({ kind: 'reply', message: '停下先别动', urgent: true });
});

test('! 前缀:!@all → urgent broadcast', () => {
  expect(parseConsoleInput('!@all 全员暂停')).toEqual({ kind: 'broadcast', message: '全员暂停', urgent: true });
});

test('! 前缀:!+路径 → 路径守卫照常生效,得 urgent reply', () => {
  expect(parseConsoleInput('!/var/folders/x/shot.png 看这张图')).toEqual({ kind: 'reply', message: '/var/folders/x/shot.png 看这张图', urgent: true });
});

test('! 前缀:命令不可插队(!/todo list)→ error', () => {
  expect(parseConsoleInput('!/todo list').kind).toBe('error');
});

test('! 前缀:单独一个 ! → error', () => {
  expect(parseConsoleInput('!').kind).toBe('error');
  expect(parseConsoleInput('!  ').kind).toBe('error');
});

test('! 前缀:!@名字(无消息体)→ error(沿用 usageMention 检查)', () => {
  expect(parseConsoleInput('!@lead').kind).toBe('error');
});

test('! 前缀:!! 开头保留字面 !(不递归吞字符)', () => {
  expect(parseConsoleInput('!!分割线')).toEqual({ kind: 'reply', message: '!分割线', urgent: true });
});

test('! 前缀:超长前导 ! 不递归爆栈,仍是 urgent reply', () => {
  const input = '!'.repeat(10000) + 'x';
  let r: ReturnType<typeof parseConsoleInput>;
  expect(() => { r = parseConsoleInput(input); }).not.toThrow();
  expect(r!.kind).toBe('reply');
  expect((r! as { urgent?: boolean }).urgent).toBe(true);
});

test('全角 ！ 别名:！@名字 → urgent say', () => {
  expect(parseConsoleInput('！@lead 改方向')).toEqual({ kind: 'say', to: 'lead', message: '改方向', urgent: true });
});

test('全角 ！ 别名:！！x → urgent reply,保留字面全角 ！', () => {
  expect(parseConsoleInput('！！x')).toEqual({ kind: 'reply', message: '！x', urgent: true });
});

test('全角 ！ 别名:单独一个 ！ → error', () => {
  expect(parseConsoleInput('！').kind).toBe('error');
});

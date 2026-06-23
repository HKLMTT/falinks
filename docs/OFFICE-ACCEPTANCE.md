# 像素办公室 (#15) 端到端验收报告

- 验收负责人 / 报告作者：qa
- 浏览器交互项实拍：lead
- 验收日期：2026-06-24
- 被测分支：main（工作区含 office 相关改动，已 `npm run build`）
- 结论：**整体通过（无阻断）**。8 项全部通过——程序化 4 项（qa）+ 浏览器交互 4 项（lead 实拍，5 张证据图见 `docs/office-ref/accept-*.png`）。唯一一例测试失败经复测确认为**与 office 无关的既有 flaky 用例**（满载下计时超时，隔离运行稳定通过），不阻断验收。

---

## 总览

| # | 验收项 | 类型 | 结果 |
|---|--------|------|------|
| 1 | 构建：`npm run build` 退出码 0、tsc 无报错、dist 产物齐全 | 程序化 | ✅ 通过 |
| 2 | 测试无回归：`npm test` 全绿 | 程序化 | ✅ 通过（1 例既有 flaky，非回归，已论证） |
| 3 | 仅绑 127.0.0.1，无对外监听 | 程序化 | ✅ 通过 |
| 4 | 不开 office 无新行为 / 无性能影响 | 程序化 | ✅ 通过 |
| 5 | `/office` 打开能渲染 | 浏览器实拍 | ✅ 通过（lead 实拍） |
| 6 | idle / busy / stuck 动画切换 | 浏览器实拍 | ✅ 通过（lead 实拍） |
| 7 | 点员工看详情 | 浏览器实拍 | ✅ 通过（lead 实拍） |
| 8 | 关闭再打开正常 | 浏览器实拍 | ✅ 通过（lead 实拍） |

---

## 1. 构建 — ✅ 通过

命令与输出：

```
$ npm run build; echo "EXIT_CODE=$?"
> @hklmtt/falinks@0.13.3 build
> tsc -p tsconfig.build.json && node scripts/copy-office-web.mjs

[copy-office-web] /Users/liujia/工作/falinks/src/office/web → /Users/liujia/工作/falinks/dist/office/web
EXIT_CODE=0
```

- 退出码 **0**，tsc **无任何报错**。

`dist/office/web` 产物清单（`find dist/office/web -type f`）：

```
dist/office/web/assets/2dpig/LargePixelOffice.png
dist/office/web/assets/2dpig/LICENSE.txt
dist/office/web/assets/2dpig/PixelOffice.png
dist/office/web/assets/2dpig/PixelOfficeAssets.png
dist/office/web/assets/2dpig/README.txt
dist/office/web/assets/floor.png
dist/office/web/assets/people.png
dist/office/web/assets/README.md
dist/office/web/assets/sprites.json
dist/office/web/assets/wall.png
dist/office/web/assets/workstation.png
dist/office/web/index.html
dist/office/web/office.css
dist/office/web/office.js
```

必需文件核对：

| 文件 | 状态 |
|------|------|
| `index.html` | ✅ 在 |
| `office.css` | ✅ 在 |
| `office.js` | ✅ 在 |
| `assets/sprites.json` | ✅ 在（位于 `assets/`，与 `office.js:453` 的 `fetch(ASSETS + 'sprites.json')` 一致） |
| png 资源 | ✅ 共 **7** 个：`assets/{floor,people,wall,workstation}.png` + `assets/2dpig/{LargePixelOffice,PixelOffice,PixelOfficeAssets}.png` |
| `assets/2dpig/` 子目录 | ✅ 在（3 png + LICENSE.txt + README.txt） |

> 备注：`sprites.json` 的正确位置是 `assets/sprites.json`（前端按 `assets/` 相对路径取）；与 dist 树、源树 `src/office/web/assets/sprites.json` 完全对应。源树与 dist 树文件清单一致，拷贝脚本工作正常。

---

## 2. 测试无回归 — ✅ 通过

命令与汇总输出：

```
$ npm test   # vitest run

 Test Files  1 failed | 93 passed (94)
      Tests  1 failed | 554 passed (555)
   Duration  16.87s
```

- 通过：**554 / 555 测试**、**93 / 94 文件**。
- office 自身测试全绿：`tests/office/serve.test.ts (10 tests)` ✅、`tests/console/parse-office.test.ts (2 tests)` ✅。

### 唯一失败例 — 判定为既有 flaky，非本次回归

```
FAIL  tests/console/app-e2e.test.tsx
  > e2e:Esc 开取消排队浮层,Enter 取消选中条 → 等送达计数缩、历史标已取消
Error: waitFor: 超时未满足条件   (tests/console/app-e2e.test.tsx:148)
```

判定依据（隔离复测 3 次，均稳定通过）：

```
$ npx vitest run tests/console/app-e2e.test.tsx   # ×3
run 1:  ✓ (5 tests) 480ms   Test Files 1 passed
run 2:  ✓ (5 tests) 530ms   Test Files 1 passed
run 3:  ✓ (5 tests) 531ms   Test Files 1 passed
```

- 该用例隔离运行稳定通过（~480–530ms）；仅在**全量并发满载**下偶发计时超时（满载时该例耗时 8131ms，远超隔离值）——属 `waitFor` 计时敏感型 e2e 的资源竞争抖动。
- 与 office 功能**完全无关**（控制台「取消排队浮层」交互），不涉及任何 office 代码路径。
- 结论：**无可归因于 office 改动的回归**；该 flaky 例建议另行跟踪（提高超时或串行化），不阻断本次验收。

---

## 3. 仅绑 127.0.0.1 — ✅ 通过

### 代码层

bus 服务器是唯一监听器，office 路由挂在它的请求钩子上、不另开监听。绑定地址硬编码为环回地址：

- `src/bus/server.ts:400` — `httpServer.listen(p, '127.0.0.1', () => { ... })`
- 端口被占用时的回退（`src/bus/server.ts:397`）走 `tryListen(0, true)` → 仍是同一 `listen(p, '127.0.0.1')`，由系统分配端口，**地址不变**。
- 全仓 `grep -rn "0\.0\.0\.0\|listen(" src/` 仅命中上面一行，**无任何 0.0.0.0 / 通配地址 / 对外网卡绑定**。

```
$ grep -rn "0\.0\.0\.0\|listen(" src/
src/bus/server.ts:400:      httpServer.listen(p, '127.0.0.1', () => {
```

### 实跑层（lsof 取证）

用 backend 的 `scripts/office-mock.mjs`（同样 `listen(PORT, '127.0.0.1')`，并调用真实 `handleOfficeRequest`）自起一份，lsof 确认监听地址：

```
$ node scripts/office-mock.mjs 4317 &
$ lsof -nP -iTCP:4317 -sTCP:LISTEN
COMMAND   PID   USER   FD   TYPE  DEVICE  SIZE/OFF NODE NAME
node    22566 liujia   12u  IPv4  ...     0t0      TCP 127.0.0.1:4317 (LISTEN)

$ lsof -nP -iTCP:4317 -sTCP:LISTEN | grep -E '0\.0\.0\.0|\*:4317'
(无输出 → no wildcard — loopback only ✅)
```

- 监听地址为 **`127.0.0.1:4317`**（IPv4 环回），**没有 `0.0.0.0` / `*:<port>` / 对外网卡**。
- `GET /office/state` 正常返回 roster JSON，证明监听的就是 office 服务本体。

---

## 4. 不开 office 无新行为 / 无性能影响 — ✅ 通过

论证 + 取证：

1. **非 office 请求路径不受影响（前缀短路）。** `src/bus/server.ts:212` 在请求入口第一行调用 `handleOfficeRequest(...)`；该函数 `src/office/serve.ts:88` 对所有非 `/office`、非 `/office/*` 路径**立即 `return false`**，bus 随后照原有逻辑分发（admin / MCP 等）。对非 office 请求的唯一开销是一次 `url.pathname` 字符串比较，不改变任何既有行为。

   ```
   src/office/serve.ts:88
     if (pathname !== '/office' && pathname !== '/office/' && !pathname.startsWith('/office/')) return false;
   ```

2. **不另开监听。** office 与 bus 共用同一个 `127.0.0.1:<port>`（见第 3 项），未新增任何 `http.createServer` / `listen`。

3. **服务端零后台活动。** `grep setInterval|setTimeout|setImmediate src/office/serve.ts` → **无**。office 服务端是纯请求驱动：没有浏览器访问 `/office*` 就没有任何 office 相关代码执行、无定时器、无后台轮询。

   ```
   $ grep -n "setInterval\|setTimeout\|setImmediate" src/office/serve.ts
   (none — purely request-driven)
   ```

4. **轮询只在客户端、且仅当浏览器打开页面时存在。** 1s 轮询是 `src/office/web/office.js:480` 的 `setInterval(poll, 1000)`，运行于浏览器、仅在用户主动打开 `/office` 后启动；服务器不主动推送、不预热。

   ```
   src/office/web/office.js:8    const POLL_MS = 1000;
   src/office/web/office.js:480  setInterval(poll, POLL_MS);   // 客户端，仅打开页面后运行
   ```

结论：**不打开 /office 时，falinks 无任何新增行为与性能影响**；只有浏览器主动访问 `/office*` 才产生流量。

---

## 5–8. 浏览器交互项（lead 实拍）

> 由 lead 用 Playwright 对 backend 的 mock 服务实拍（`http://127.0.0.1:4317`，`webRoot=dist/office/web`，含 `/mock/set` 现场翻状态）。5 张证据图见 `docs/office-ref/accept-*.png`。**4 项全部通过 ✅。**

### 5. `/office` 打开能渲染 — ✅ 通过（lead 实拍）
- 证据：`docs/office-ref/accept-01-render.png`
- 结果：页面标题「falinks · 像素办公室」，7 人全渲染（lead / frontend / backend / qa / ux / stuck 工位 + intern 虚拟成员在沙发），装饰（植物 / 猫 / 自动售货机 / 门窗）正常；静态资源从 `dist/office/web` 加载成功。i18n 佐证：顶栏/面板文案走 office.js 内联字典，中文正常显示（像素办公室 / 角色 / 相关消息 / 忙碌 等）。
- 唯一 console 报错：`/favicon.ico` 404（浏览器默认请求、无 favicon，纯 cosmetic，不影响功能）。

### 6. idle / busy / stuck 动画切换 — ✅ 通过（lead 实拍）
- 证据：`accept-01-render.png`（idle）、`accept-02-frontend-busy.png`（busy）、`accept-03-frontend-stuck.png`（stuck）
- 结果：对 frontend 用 `/mock/set` 翻态实拍，三态视觉明显区分、状态轮询后即时切换：
  - **idle**：裸地砖、无浮标
  - **busy**：绿色发光地台 + busy 浮标出现
  - **stuck（unresponsive）**：琥珀地台 + 橙色「…」告警浮标

### 7. 点员工看详情 — ✅ 通过（lead 实拍）
- 证据：`docs/office-ref/accept-04-detail-panel.png`
- 结果：点 backend 工位，右侧详情面板显示「backend / 忙碌 状态药丸 / 角色：后端开发 / 相关消息」，并列出该员工相关消息（lead→backend、backend→lead 两条带时间）；被选工位有高亮框；URL 同步 `#sel=backend`。

### 8. 关闭再打开正常 — ✅ 通过（lead 实拍）
- 证据：`docs/office-ref/accept-05-reopen.png`
- 结果：关闭 `/office` 再重新打开，整屏正常渲染、详情面板复位为「点击工位查看详情」、无残留、console 仅 favicon 404。
- **额外正向发现（断线韧性）**：mock 服务中途掉线时，前端正确显示红色「连接已断开，正在重试…」横幅 + 画面变暗 + 自动重试 `/office/state`，服务恢复后干净重连（`accept-04` 恰好抓到断线横幅态）。

---

## 附：复现环境

- 平台：darwin (Darwin 25.5.0)
- 包版本：`@hklmtt/falinks@0.13.3`
- 测试框架：vitest（`npm test` = `vitest run`）
- mock：`node scripts/office-mock.mjs [port]`（绑 127.0.0.1，默认 4317；`/mock/set`、`/mock/state` 控制端点）

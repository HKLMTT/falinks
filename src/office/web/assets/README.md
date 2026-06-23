# 像素办公室 sprite 使用说明（前端引用清单）

> 素材加工产出，供 `src/office/web/office.js` 渲染用。
> 画风遵循 `docs/SPRITE-SPEC.md`（暖色 cozy 俯视）。预览见 `docs/office-ref/sprite-preview.png`。
> 重新生成所有图：`python3 src/office/build-sprites.py`
> **致谢**：Office sprites by 2dPig (CC0)。

## 文件一览（均在 `src/office/web/assets/`）

| 文件 | 内容 | 来源 |
|---|---|---|
| `sprites.json` | 全部坐标 / 调色板 / 状态 / 图层约定（**单一事实源**，前端读它） | — |
| `2dpig/PixelOfficeAssets.png` | 原始图集：装饰/家具/动物坐标都指向它 | 2dPig CC0 |
| `people.png` | 5 个小人**坐姿半身**（头+肩），每人 2 帧 | 由站姿合成 |
| `floor.png` | 暖米棋盘格地砖（2 块 16×16：A 浅 / B 深） | 程序化（暖板） |
| `wall.png` | 暖墙竖切片 16×40（暖壁+木墙裙+踢脚线） | 程序化（暖板） |
| `workstation.png` | 木桌+显示器，5 状态横排（前层，盖住小人下半身） | 程序化（暖板） |

原始冷蓝地板/墙**没用**，已按 SPRITE-SPEC 暖板程序化重做；2dpig 原图保留未改。

## 怎么画一个工位（图层从下到上）

`sprites.json.layering` = `["floor","wall","chair","person(bust)","workstation","floater"]`

```js
const S = await fetch('assets/sprites.json').then(r=>r.json());
// 1) 地砖：棋盘格交替 A/B —— floor.png 取 S.floor.tiles.A / .B（16px）
// 2) 后墙：wall.png 平铺（仅房间顶部带）
// 3) 椅子：从 2dpig 图集取 S.atlas.sprites.chair_orange（[x,y,w,h]）
// 4) 小人半身：people.png
//    col = S.people.order.indexOf(empKey)         // 列 → x = col*CELL_W
//    row = busy ? S.people.frames.type : .rest    // 行 → y = row*CELL_H
//    cell = S.people.cell = [20,15]
//    摆放：头顶高出显示器上沿 ~6px（bust 顶 = 显示器顶 - 6），肩部被显示器挡住
// 5) workstation.png：col = S.workstation.states[status]（idle/busy/waiting/done/offline）
//    cell = [36,22]，桌沿压在小人腰前
// 6) 头顶浮标：见状态表（CSS 画，不是图）
```

所有图 `image-rendering: pixelated;`，整体放大用整数倍（建议 ×3~×4）。

## 状态系统（`sprites.json.status`，5 态）

| 状态 | 状态色 | 脚下 tile（一级·主） | 头顶浮标（二级·冗余） | 小人/屏 |
|---|---|---|---|---|
| idle | `#8893A8` | 不发光 | 无 | 肩慢呼吸；屏 2 行暗码 |
| busy | `#5FB84A` | 绿**脉冲**发光 | 实心圆 `●` | 用 type 帧（头微点）；屏满行 |
| waiting | `#F2A33C` | 琥珀**呼吸**发光 | `…` 三点 | 静止；屏 1 行 |
| done | `#2FA4C8` | 青**闪 1 次**后常亮 1.5s | `✓` 弹出 | 屏青码 |
| offline | `#5A5A60` | tile **压暗** | `!` | 小人 **50% 透明**；屏黑 |

- **一级 = 脚下地砖整格染状态色 + 发光**（CSS：在该工位地砖格上叠 `box-shadow`/径向 glow + `@keyframes` 脉冲/呼吸/闪）。这是远看主通道。
- **二级 = 头顶形状浮标**（CSS 画的小圆/点/勾/叹号，1px 深描边底），保证缩略图/静帧也能分。
- workstation.png 的 5 列已是对应屏幕状态，直接选列即可。
- offline 小人透明：对 people 那一格上 `opacity:.5`。

红线（来自 SPRITE-SPEC §6）：状态绝不能只靠身体色或仅靠动画；脚下 tile 发光为主、头顶浮标为辅；静帧也要可分。

## 角色 → 素材对应建议

`S.people.order` = `["p1_dark","p2_auburn","p3_glasses","p4_pony","p5_long"]`
- `p3_glasses`（银发+眼镜）建议给 **lead**（`S.people.leadSuggest`），气质最像组长；也可另叠小皇冠/徽标浮标。
- `boss`(virtual) 不渲染工位，或放在 `elevator` 门口/`sofa_red` 休息区。
- 真实员工按 roster 顺序循环取 order 即可；同人复用同列。

## 可选装饰（`S.atlas.sprites`，点缀房间，按需取）

椅子 `chair_{orange,yellow,green,blue,white,gray}`、沙发 `sofa_{red,green,blue,gray}`（暖调优先 `sofa_red`）、
`plant_tall`、`elevator`（暖光双门）、`vending1/2`、`win_blue1/2`、`win_tall`、`counter`、
`cat`（黑猫）、`corgi`（柯基）、`bench_sm/lg`。坐标全在 `sprites.json`。

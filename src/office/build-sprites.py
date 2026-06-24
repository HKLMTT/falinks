#!/usr/bin/env python3
"""falinks 像素办公室 sprite 生成器.

输入: src/office/web/assets/2dpig/PixelOfficeAssets.png (CC0, by 2dPig)
输出 (src/office/web/assets/):
  people.png       — 5 个小人坐姿 head+shoulders 半身, 每人 2 帧 (rest / 打字头微点)
  floor.png        — 暖米棋盘格地砖 (2 块 16x16)
  wall.png         — 暖调墙 (上半暖壁 + 下半木墙裙 + 踢脚线), 16 宽竖切片
  workstation.png  — 木桌 + 显示器, 4 状态 (idle/busy/done/offline) 横排
  sprites.json     — 全部坐标 / 调色板 / 图层约定

按 docs/SPRITE-SPEC.md 暖色板生成程序化素材; 小人/动物/装饰直接取自 2dpig 图集坐标.
重新运行: python3 src/office/build-sprites.py
"""
import json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, 'src', 'office', 'web', 'assets')
SRC = os.path.join(ASSETS, '2dpig', 'PixelOfficeAssets.png')

# ---- SPRITE-SPEC 暖色板 ----
PAL = {
    'tileA': '#E8D5A8', 'tileB': '#D9C088', 'seam': '#C8A86A',
    'skirt': '#8A5A38', 'skirtHi': '#A6724A', 'skirtLo': '#6E4423',
    'wall': '#B8946A', 'wallLo': '#9C7850', 'base': '#5C3A20',
    'wood': '#9C6B3E', 'woodHi': '#C08B54', 'woodLo': '#7A4F2A', 'woodSeam': '#5C3A20',
    'screen': '#1E2A33', 'code': '#5FB0C8',
    'idle': '#8893A8', 'busy': '#5FB84A', 'waiting': '#F2A33C', 'stuck': '#D2483A', 'done': '#2FA4C8', 'offline': '#5A5A60',
    'warmGlow': '#F2C879',
}
def C(h):
    h = h.lstrip('#'); return (int(h[0:2],16), int(h[2:4],16), int(h[4:6],16), 255)

def newimg(w, h):
    return Image.new('RGBA', (w, h), (0,0,0,0))

def rect(im, x, y, w, h, col):
    for j in range(y, y+h):
        for i in range(x, x+w):
            if 0 <= i < im.width and 0 <= j < im.height:
                im.putpixel((i, j), col)

# ---------- 1. people.png : 统一 16-骨架 坐姿半身 (head + shoulders) ----------
# 红线#4: 所有小人共用同一头/眼骨架, 差异只换发色 + 衫色 (lead 另加眼镜).
# 眼睛固定在同一行 → 全员相对显示器上沿的露出锚点完全一致 (修 reveal 不齐).
# 程序化绘制 (不再裁 2dpig 不同来源的头), 杜绝大小头/飘发/合成 bug.
SKIN, SKIN_SH, EYE, GLASS, GLASS_LENS = '#F2C896', '#D69A66', '#3A2A1E', '#2C2C34', '#101820'
# key -> (hair, shirt, shirtSh, style)
PEOPLE = {
    'p1_dark':    ('#46362A', '#AEB8C6', '#828DA0', 'short'),    # 棕短发 + 灰蓝衫
    'p2_auburn':  ('#9B4A2F', '#E7DBBE', '#BFAE82', 'short'),    # 红褐发 + 米白衫
    'p3_glasses': ('#C2C6CE', '#E0E0E6', '#B4B4BE', 'glasses'),  # 银发 + 眼镜 (lead)
    'p4_red':     ('#C9543B', '#5B86C0', '#3E5E8C', 'short'),    # 红发 + 蓝衫
    'p5_long':    ('#23232E', '#8E3D49', '#5E2832', 'long'),     # 黑长发 + 暗红衫
}
CELL_W, CELL_H = 20, 15   # 半身格; 头部居中, cx=10
# 显示器上沿落在小人 y7 → 可见头 = y0–6, 眼固定在 y4 (上沿之上一点点), 全员同高.
def draw_bust(im, ox, oy, hair, shirt, shirtSh, style, bob, sleep=False):
    sk, ss = C(SKIN), C(SKIN_SH)
    hi, sh, shs, ey = C(hair), C(shirt), C(shirtSh), C(EYE)
    def R(x0, x1, y, col): rect(im, ox + x0, oy + y, x1 - x0 + 1, 1, col)
    def P(x, y, col):      rect(im, ox + x, oy + y, 1, 1, col)
    # --- 衫/肩 (固定, 不随 bob; 基本被显示器遮, 仅作体积) ---
    R(4, 15, 9, sh); R(3, 16, 10, sh); R(3, 16, 11, sh); R(2, 17, 12, sh); R(2, 17, 13, sh)
    R(4, 6, 9, shs); R(13, 15, 9, shs)
    R(2, 3, 12, shs); R(16, 17, 12, shs)
    b = bob
    # --- 脖子 (随 bob) ---
    R(9, 11, 7 + b, sk); R(9, 11, 8 + b, ss)
    # --- 长发: 鬓角下延 (头框内, 不外飘) 先于脸画 ---
    if style == 'long':
        for y in (3, 4, 5, 6):
            P(5, y + b, hi); P(14, y + b, hi)
    # --- 头 (随 bob), 全员同骨架 ---
    R(6, 13, 0 + b, hi)              # 发冠顶
    R(5, 14, 1 + b, hi)
    R(5, 14, 2 + b, hi)
    R(6, 13, 3 + b, sk)             # 额下脸
    P(5, 3 + b, hi); P(14, 3 + b, hi)
    R(6, 13, 4 + b, sk)             # 眼行
    P(5, 4 + b, hi); P(14, 4 + b, hi)
    R(6, 13, 5 + b, sk)
    R(7, 12, 6 + b, sk)             # 下巴收窄
    P(6, 5 + b, ss); P(13, 5 + b, ss)   # 颧影
    # --- 眼 / 眼镜 (sleep=闭眼: 横线/镜片后闭眼线) ---
    if style == 'glasses':
        P(7, 3 + b, hi); P(12, 3 + b, hi)               # 镜框上沿
        lens = ey if sleep else C(GLASS_LENS)           # 闭眼时镜片像素改画闭眼线(藏镜片后), 镜框保留
        P(7, 4 + b, C(GLASS)); P(8, 4 + b, lens)        # 左镜片
        P(9, 4 + b, C(GLASS)); P(10, 4 + b, C(GLASS))   # 鼻梁
        P(11, 4 + b, lens); P(12, 4 + b, C(GLASS))      # 右镜片
    elif sleep:
        R(7, 8, 4 + b, ey); R(11, 12, 4 + b, ey)        # 短横线闭眼 "—  —"
    else:
        P(8, 4 + b, ey); P(11, 4 + b, ey)
def build_people(src):
    order = list(PEOPLE.keys())
    sheet = newimg(CELL_W * len(order), CELL_H * 3)  # 行0=rest 行1=打字(头微点1px) 行2=sleep(闭眼)
    for col, key in enumerate(order):
        hair, shirt, shirtSh, style = PEOPLE[key]
        ox = col * CELL_W
        draw_bust(sheet, ox, 0,         hair, shirt, shirtSh, style, 0)               # rest
        draw_bust(sheet, ox, CELL_H,    hair, shirt, shirtSh, style, 1)               # 打字: 头微点下移 1px
        draw_bust(sheet, ox, CELL_H*2,  hair, shirt, shirtSh, style, 0, sleep=True)   # sleep: 闭眼(点头由 CSS 叠)
    sheet.save(os.path.join(ASSETS, 'people.png'))
    return order

# ---------- 2. floor.png : 暖米棋盘格 ----------
def build_floor():
    t = 16
    im = newimg(t * 2, t)  # 两块: A(浅) / B(深)
    rect(im, 0, 0, t, t, C(PAL['tileA']))
    rect(im, t, 0, t, t, C(PAL['tileB']))
    # 砖缝: 右 + 下 1px
    for x0, col in ((0, PAL['tileA']), (t, PAL['tileB'])):
        rect(im, x0, t-1, t, 1, C(PAL['seam']))
        rect(im, x0+t-1, 0, 1, t, C(PAL['seam']))
    im.save(os.path.join(ASSETS, 'floor.png'))

# ---------- 3. wall.png : 暖墙竖切片 (16 宽, 顶视微透视的后墙) ----------
def build_wall():
    w, h = 16, 40
    im = newimg(w, h)
    rect(im, 0, 0, w, 22, C(PAL['wall']))        # 上半暖壁
    rect(im, 0, 20, w, 2, C(PAL['wallLo']))      # 暖壁底阴影
    rect(im, 0, 22, w, 14, C(PAL['skirt']))      # 下半木墙裙
    rect(im, 0, 22, w, 1, C(PAL['skirtHi']))     # 墙裙高光
    rect(im, 0, 34, w, 2, C(PAL['skirtLo']))     # 墙裙暗
    rect(im, 0, 36, w, 4, C(PAL['base']))        # 踢脚线
    im.save(os.path.join(ASSETS, 'wall.png'))

# ---------- 4. workstation.png : 木桌 + 显示器, 4 状态 ----------
# 单格 36x22: 桌占下 8px, 显示器立于桌上, 小人头肩从显示器上沿露出
WS_W, WS_H = 36, 22
def draw_monitor(im, ox, screen_fill, code_rows):
    # 显示器: 居中, 宽 16, 高 12, 立在桌面上 (桌面在 y14)
    mx = ox + (WS_W - 16) // 2
    my = 1
    rect(im, mx, my, 16, 12, C(PAL['woodSeam']))          # 外框
    rect(im, mx+1, my+1, 14, 10, screen_fill)             # 屏底
    for ry in code_rows:                                  # 代码行
        rect(im, mx+2, my+1+ry, 10, 1, C(PAL['code']))
    rect(im, mx+6, my+12, 4, 2, C(PAL['woodSeam']))       # 支架
def draw_desk(im, ox):
    rect(im, ox, 14, WS_W, 2, C(PAL['woodHi']))           # 桌沿高光
    rect(im, ox, 16, WS_W, 6, C(PAL['wood']))             # 木面
    rect(im, ox, 20, WS_W, 2, C(PAL['woodLo']))           # 木面暗
    rect(im, ox+2, 21, 2, 1, C(PAL['woodSeam']))          # 腿
    rect(im, ox+WS_W-4, 21, 2, 1, C(PAL['woodSeam']))
def build_workstation():
    states = ['idle', 'busy', 'waiting', 'done', 'offline']
    im = newimg(WS_W * len(states), WS_H)
    screen = C(PAL['screen'])
    black = (10,12,15,255)
    mxoff = (WS_W - 16) // 2            # 显示器在格内的左偏移
    for i, st in enumerate(states):
        ox = i * WS_W
        if st == 'offline':
            draw_monitor(im, ox, black, [])
        elif st == 'busy':
            draw_monitor(im, ox, screen, [1,3,5,7,9])     # 满屏滚动
        elif st == 'done':
            draw_monitor(im, ox, C(PAL['done']), [2,5,8])
        elif st == 'waiting':
            draw_monitor(im, ox, screen, [])              # 基屏
            # 醒目琥珀提示条 (呼应状态色, 静帧也能跟 idle 分开)
            rect(im, ox+mxoff+2, 5, 10, 2, C(PAL['waiting']))
            rect(im, ox+mxoff+2, 7, 10, 1, C(PAL['woodLo']))   # 提示条下沿压暗
        else: # idle: 屏暗淡、只 2 行微光 (近休眠)
            draw_monitor(im, ox, C('#16202B'), [3,6])
        draw_desk(im, ox)
    im.save(os.path.join(ASSETS, 'workstation.png'))
    return states

# ---------- 5. 2dpig 图集坐标 (装饰 / 动物 / 椅子) ----------
ATLAS = {
    'chair_orange': [6,41,11,22], 'chair_yellow': [19,41,11,22], 'chair_green': [32,41,11,22],
    'chair_blue': [45,41,11,22], 'chair_white': [58,41,11,22], 'chair_gray': [71,41,11,22],
    'bench_sm': [85,47,26,16], 'bench_lg': [115,47,40,16], 'counter': [171,44,79,17],
    'sofa_gray': [119,66,33,15], 'sofa_blue': [120,83,33,16],
    'sofa_green': [120,102,33,16], 'sofa_red': [120,121,31,16],
    'plant_tall': [170,65,14,19], 'elevator': [185,60,49,30],
    'vending1': [159,123,24,34], 'vending2': [184,126,24,31],
    'win_blue1': [59,96,26,21], 'win_blue2': [88,96,26,21], 'win_tall': [98,120,16,31],
    'cat': [65,129,16,13], 'corgi': [59,146,24,11],
    'monitor_unit_green': [114,143,9,14], 'monitor_unit_red': [124,143,10,14],
    'monitor_unit_blue': [134,143,11,14], 'pc_pokeball': [147,140,9,17],
}

def main():
    src = Image.open(SRC).convert('RGBA')
    people_order = build_people(src)
    build_floor()
    build_wall()
    ws_states = build_workstation()
    # stuck 暂复用 waiting 列(列2): 工位屏不新增列, stuck 的差异走地台/浮标/小人抖
    st = {s: i for i, s in enumerate(ws_states)}
    ws_state_map = {'idle': st['idle'], 'busy': st['busy'], 'waiting': st['waiting'],
                    'stuck': st['waiting'], 'done': st['done'], 'offline': st['offline']}

    manifest = {
        '_credit': 'Office sprites by 2dPig (CC0). Warm recolor + seated busts + workstation for falinks.',
        'palette': PAL,
        'status': {
            'idle':    {'color': PAL['idle'],    'tileGlow': False, 'floater': None,  'note': '本色地砖, 肩慢呼吸'},
            'busy':    {'color': PAL['busy'],    'tileGlow': 'pulse','floater': 'dot', 'note': '绿脉冲, 打字头微点+屏滚动'},
            'waiting': {'color': PAL['waiting'], 'tileGlow': 'breath','floater':'dots','note': '琥珀地台(强对比+深描边), 屏顶琥珀提示条'},
            'stuck':   {'color': PAL['stuck'],   'tileGlow': 'pulse-fast','floater':'bang-tri','note': '卡住/无响应: 警示红快脉冲(0.7s)+深环, 三角!浮标, 小人微抖'},
            'done':    {'color': PAL['done'],    'tileGlow': 'flash','floater': 'check','note': '青光闪1次后余辉常亮再淡出(共3s), ✓ pop 入场'},
            'offline': {'color': PAL['offline'], 'tileGlow': 'dim',  'floater': 'cross','note': '熄灭, 小人50%透明屏黑, ✕灰空心浮标'},
        },
        'atlas': {
            'image': '2dpig/PixelOfficeAssets.png',
            'sprites': ATLAS,
        },
        'people': {
            'image': 'people.png',
            'cell': [CELL_W, CELL_H],
            'frames': {'rest': 0, 'type': 1, 'sleep': 2},   # 行索引 (y = row*CELL_H); sleep=闭眼(打盹)
            'order': people_order,              # 列索引 (x = col*CELL_W)
            'leadSuggest': 'p3_glasses',
            'note': '统一 16-骨架坐姿半身(头+肩); 全员同头/眼骨架, 只换发色+衫色, lead 加眼镜. 眼固定行→露出锚点齐. 置于显示器上沿之后(下层). sleep 行=闭眼(横线/镜片后), 打盹时由 office.js 切, 点头 bob 走 CSS.',
        },
        'floor':       {'image': 'floor.png', 'tile': 16, 'tiles': {'A': [0,0,16,16], 'B': [16,0,16,16]}},
        'wall':        {'image': 'wall.png', 'size': [16,40]},
        'workstation': {'image': 'workstation.png', 'cell': [WS_W, WS_H],
                        'states': ws_state_map,
                        'note': '木桌+显示器(前层). stuck 暂复用 waiting 列(列2), 新列归 P1. 图层: 地砖 < 椅子 < 小人半身 < workstation < 头顶浮标.'},
        'layering': ['floor', 'wall', 'chair', 'person(bust)', 'workstation', 'floater'],
    }
    with open(os.path.join(ASSETS, 'sprites.json'), 'w') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print('done ->', ASSETS)

if __name__ == '__main__':
    main()

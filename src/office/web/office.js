/* falinks 像素办公室 — 渲染与轮询（只读）。
   数据：GET /office/state（1s 轮询）。素材清单：assets/sprites.json（单一事实源）。
   状态两级冗余：一级=脚下 tile 染色发光，二级=头顶形状浮标。 */
(() => {
  'use strict';

  const ASSETS = 'assets/';
  const POLL_MS = 1000;
  const FRAME_MS = 250;          // 打字微动 ~4fps
  const BUBBLE_MS = 4500;
  const DONE_MS = 3000;          // busy→idle done 可感知窗口(青余辉, SPEC P0-2 D)
  const MAX_MISS = 2;            // 连续轮询失败数后判定断连

  // ---- i18n（内联小词典，?lang= 切换；key 对齐 zh/en） ----
  const LANG = (new URLSearchParams(location.search).get('lang') || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
  const T = {
    zh: { subtitle: '像素办公室', empty: '暂无成员', hint: '点击工位查看详情', disconnected: '连接已断开，正在重试…',
          role: '角色', messages: '相关消息', waiting: '待回答', noMessages: '暂无相关消息',
          overview: '团队概览', legend: '状态图例', lastDone: '上次完成', resting: '离座', boss: '坐镇',
          st: { idle:'空闲', busy:'忙碌', waiting:'等待', stuck:'卡住', done:'完成', offline:'离线' },
          stat: { idle:'在岗', busy:'忙', waiting:'等待', stuck:'卡住', offline:'离线' } },
    en: { subtitle: 'Pixel Office', empty: 'No members', hint: 'Click a desk for details', disconnected: 'Disconnected — retrying…',
          role: 'Role', messages: 'Related messages', waiting: 'Awaiting answer', noMessages: 'No related messages',
          overview: 'Team', legend: 'Legend', lastDone: 'Last done', resting: 'Away', boss: 'Overseeing',
          st: { idle:'Idle', busy:'Busy', waiting:'Waiting', stuck:'Stuck', done:'Done', offline:'Offline' },
          stat: { idle:'Idle', busy:'Busy', waiting:'Wait', stuck:'Stuck', offline:'Offline' } },
  }[LANG];

  document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';
  document.getElementById('subtitle').textContent = T.subtitle;
  document.getElementById('empty').textContent = T.empty;
  document.getElementById('panel-hint').textContent = T.hint;
  document.getElementById('ov-title').textContent = T.overview;
  document.getElementById('ov-legend-title').textContent = T.legend;
  document.getElementById('panel-msgs-label').textContent = T.messages;
  document.getElementById('banner').textContent = T.disconnected;

  // ---- 元素 ----
  const $stageWrap = document.getElementById('stage-wrap');
  const $stage = document.getElementById('stage');
  const $wall = document.getElementById('wall');
  const $floor = document.getElementById('floor');
  const $decor = document.getElementById('decor');
  const $lounge = document.getElementById('lounge');
  const $desks = document.getElementById('desks');
  const $bubbles = document.getElementById('bubbles');
  const $empty = document.getElementById('empty');
  const $banner = document.getElementById('banner');
  const $panel = document.getElementById('panel');
  const $overview = document.getElementById('panel-overview');
  const $ovStats = document.getElementById('ov-stats');
  const $ovLegend = document.getElementById('ov-legend');

  // ---- 几何（与 SPRITE-SPEC 一致） ----
  const SCALE = 4;
  const CELL = 16 * SCALE;       // 64 地砖像素
  const WS_W = 36, WS_H = 22;    // workstation cell
  const STA_W = WS_W * SCALE;    // 144 工位占位宽
  const STA_H = 28 * SCALE;      // 112 (6 头顶 + 22 工位)
  const GAP_X = 30, GAP_Y = 46;  // 工位间距
  const COLS_MAX = 5;            // 单行工位上限(超出分行成方阵, 消灭单人尾行)
  const PAD = 28;                // 房间内边距
  const WALL_H = 40 * SCALE;     // 后墙带高
  const COMMONS_H = 150;         // 工位下方公共休息带高
  const TOP_GAP = 24;            // (保留)
  const VPAD = 30;              // 地面区(墙带以下)内 desk 块上下对称留白 → 含墙光学居中
  const ROOM_ASPECT = 1.4;       // 房间最小横宽比(消左右大留白 / 大屏铺满; 1.4 兼顾 1280 与 1920)
  const FIT_MIN = 0.5, FIT_MAX = 2;// fit 缩放系数夹取区间(下限<1 让窄屏 shrink-to-fit, 不溢出不裁切)

  let S = null;                  // sprites.json
  let imgs = {};                 // 预加载图（含 naturalWidth/Height）
  let state = null;              // 最近一次 /office/state
  let selected = null;           // 选中成员名
  let frame = 0;                 // 打字帧
  let misses = 0;                // 连续失败计数
  let booted = false;
  const lastMsgTs = {};          // name -> 最近一次已展示气泡的消息 ts
  const bubbleState = {};        // name -> { el, timer } 说话气泡(每人至多 1)
  let curL = null;               // 最近一次布局(供气泡锚点/边界用)
  let bossOnScreen = false;      // 当前 roster 是否含 boss(气泡锚点判定)
  const doneUntil = {};          // name -> ts(ms) done 闪结束时刻
  const lastDoneAt = {};         // name -> 最近一次 busy→idle 完成时刻(ms)
  const prevStatus = {};         // name -> 上次原始 status
  const busyTierShown = {};      // name -> 当前显示的繁忙强度档(0-3)
  const busyDownSince = {};      // name -> 开始满足降档的时刻(ms; 1s 迟滞防抖)
  const stations = new Map();    // name -> {el, parts...}

  // ---------- 工具 ----------
  function loadImg(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('load fail: ' + src));
      im.src = src;
    });
  }

  // 在 el 上设置一个 sprite（背景裁切）。coords=[x,y,w,h]，img 提供整图尺寸。
  function setSprite(el, img, coords) {
    const [x, y, w, h] = coords;
    el.style.setProperty('--bx', x);
    el.style.setProperty('--by', y);
    el.style.setProperty('--w', w);
    el.style.setProperty('--h', h);
    el.style.setProperty('--bw', img.naturalWidth);
    el.style.setProperty('--bh', img.naturalHeight);
    el.style.backgroundImage = `url(${img.src})`;
  }

  function mkSpr(cls, img, coords) {
    const el = document.createElement('div');
    el.className = 'spr ' + cls;
    setSprite(el, img, coords);
    return el;
  }

  // ---- 原始 roster status → 6 态视觉(状态视觉编码规范 单一事实源见 OFFICE-REDESIGN.md) ----
  function visualState(agent, questionFroms) {
    const raw = agent.status;
    if (raw === 'dead') return 'offline';
    if (questionFroms.has(agent.name)) return 'waiting';     // 有待答问题=正常等待(优先于 stuck)
    if (raw === 'stuck' || agent.unresponsive) return 'stuck'; // 卡住/无响应=需介入(从 waiting 拆出)
    if (raw === 'busy') return 'busy';
    if (raw === 'launching') return 'idle';
    // busy→idle 的短暂 done 闪
    if (doneUntil[agent.name] && Date.now() < doneUntil[agent.name]) return 'done';
    return 'idle';
  }

  function statusLabel(v) { return T.st[v] || v; }

  // boss 主位:独立分支渲染,不参与 6 态/强度。按 name 识别(falinks 约定的老板)。
  function isBoss(a) { return !!a && a.name === 'boss'; }

  // 繁忙强度分档(仅 busy 内部子维度,不改 6 态):队列越长动得越凶。
  // 档位 L0 queue0 / L1 1-2 / L2 3-4 / L3 ≥5;升档即时,降档 1s 迟滞防抖。
  function busyTierFor(name, queue) {
    const q = queue || 0;
    const target = q >= 5 ? 3 : q >= 3 ? 2 : q >= 1 ? 1 : 0;
    const shown = busyTierShown[name] || 0;
    let next;
    if (target >= shown) {                 // 升档(或持平)即时
      next = target; busyDownSince[name] = 0;
    } else {                                // 降档需持续 1s
      if (!busyDownSince[name]) busyDownSince[name] = Date.now();
      if (Date.now() - busyDownSince[name] >= 1000) { next = target; busyDownSince[name] = 0; }
      else next = shown;
    }
    busyTierShown[name] = next;
    return next;
  }

  // 浮标字形：唯一事实源 = sprites.json.status[*].floater(key) → 字符。
  // 头顶浮标 / 右栏图例 都走这里，杜绝第二处硬编码(防漂移)。
  const FLOATER_GLYPH = { dot: '', dots: '…', check: '✓', 'bang-tri': '!', cross: '✕' };
  function floaterKey(vis) { return S && S.status[vis] && S.status[vis].floater; }
  function floaterGlyph(vis) { const f = floaterKey(vis); return f ? (FLOATER_GLYPH[f] || '') : ''; }

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---------- 静态房间 ----------
  // 几何: 均衡分行(方阵) + 横宽比下限(消左右大留白) + 工位块垂直居中 + 休息角坐标。
  function computeLayout(deskCount, hasBoss) {
    const rows = Math.max(1, Math.ceil(deskCount / COLS_MAX));
    const perRow = Math.max(1, Math.ceil(deskCount / rows));
    const deskBlockW = perRow * STA_W + (perRow - 1) * GAP_X;
    const deskBlockH = rows * STA_H + (rows - 1) * GAP_Y;

    const floorTop = Math.round(WALL_H * 0.62);     // 地面贴墙裙(铺到墙带下沿之后)
    const MID_GAP = 14;
    // boss 主位占顶部一带(大班椅+暖毯+铭牌 + 与首排纵向错开≥1CELL); 无 boss 时退化为对称留白
    const BOSS_BAND = hasBoss ? 146 : 0;
    const desksTop = WALL_H + (hasBoss ? BOSS_BAND : VPAD);
    const commonsTop = desksTop + deskBlockH + MID_GAP;
    const commonsBottom = commonsTop + COMMONS_H;
    const roomH = commonsBottom + VPAD;

    const minW = PAD * 2 + deskBlockW;
    const roomW = Math.max(minW, Math.round(roomH * ROOM_ASPECT));
    const deskLeft0 = Math.round((roomW - deskBlockW) / 2);

    // boss 主位几何: 房间上方正中、椅背靠墙
    // 不变量: boss 坐镇区恒落在后墙带之下(seatTop≈WALL_H),而窗都贴墙带顶部(底沿 < WALL_H),
    // 二者纵向永不重叠 → 挤窗判定(≥0.5CELL 或 纵向不重叠)始终满足、中轴位恒成立,
    // 故 OFFICE-REDESIGN 的"先挪中央窗→退左上角"回退分支当前为死分支(YAGNI 未实现)。
    // ⚠️ 若日后改动 boss 位置或窗位置/尺寸,需重新评估此不变量与回退分支。
    const bossCX = Math.round(roomW / 2);
    const bossSeatTop = WALL_H - 4;

    // 休息角(纯装饰: 沙发+地毯+猫狗, 不再坐人)落在公共带左中
    const rugW = Math.max(180, Math.min(280, Math.round(roomW * 0.30)));
    const rugH = 96;
    const loungeX = Math.round(roomW * 0.30 - rugW / 2);
    const loungeY = commonsTop + 26;

    return { rows, perRow, deskCount, deskBlockW, deskBlockH, roomW, roomH,
             floorTop, desksTop, commonsTop, commonsBottom, deskLeft0,
             hasBoss, bossCX, bossSeatTop, rugW, rugH, loungeX, loungeY };
  }

  function layoutRoom(deskCount, hasBoss) {
    const L = computeLayout(deskCount, hasBoss);
    $stage.style.width = L.roomW + 'px';
    $stage.style.height = L.roomH + 'px';
    $stage.style.setProperty('--cell', CELL + 'px');

    $wall.style.height = WALL_H + 'px';
    $wall.style.backgroundImage = `url(${imgs.wall.src})`;
    $wall.style.backgroundSize = `${imgs.wall.naturalWidth * SCALE}px ${WALL_H}px`;

    $floor.style.top = L.floorTop + 'px';
    $floor.style.backgroundSize = `${CELL * 2}px ${CELL * 2}px`;
    return L;
  }

  // fit-to-viewport: 固定 SCALE 之上叠 transform:scale(k), 铺满 wrap 又不糊像素。
  function fitStage() {
    if (!S || !$stage.offsetWidth) return;
    const PADW = 16;                                // 与 #stage-wrap padding 对齐
    const availW = Math.max(1, $stageWrap.clientWidth - PADW * 2);
    const availH = Math.max(1, $stageWrap.clientHeight - PADW * 2);
    let k = Math.min(availW / $stage.offsetWidth, availH / $stage.offsetHeight);
    k = Math.floor(k * 4) / 4;                       // 吸附 0.25 倍, 防非整数缩放糊像素
    k = Math.max(FIT_MIN, Math.min(FIT_MAX, k));
    $stage.style.transformOrigin = 'center center';
    $stage.style.transform = 'scale(' + k + ')';
  }

  // 家具按 4 功能区错落布置(角落锚 + 对角, 杜绝一字排/孤件); 任一件离工位行/浮标/boss ≥0.75CELL(SPEC红线5)。
  function buildDecor(L) {
    $decor.innerHTML = '';
    const atlas = imgs.atlas, sp = S.atlas.sprites;
    const add = (key, left, top, z) => {
      if (!sp[key]) return null;
      const el = mkSpr('decor-' + key, atlas, sp[key]);
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
      if (z != null) el.style.zIndex = z;
      $decor.appendChild(el);
      return el;
    };
    const sw = (k) => (sp[k] ? sp[k][2] * SCALE : 0);
    const sh = (k) => (sp[k] ? sp[k][3] * SCALE : 0);
    const W = L.roomW, s = SCALE;
    const deskRight = L.deskLeft0 + L.deskBlockW;
    const cBot = L.commonsBottom;
    const CLEAR = Math.round(0.75 * CELL);             // 离工位/boss 最小净距

    // 墙上窗(暖光透入, 不动)
    add('win_blue1', W * 0.12, WALL_H * 0.18);
    add('win_blue2', W * 0.12 + (sp.win_blue1[2] + 6) * s, WALL_H * 0.18);
    add('win_tall', W * 0.80, WALL_H * 0.08);

    // ── A 休息区(底左角): 沙发错位成 L 角(灰后左/红前右, 两张都露出) + 暖毯锚 + 猫狗 ──
    const aX = PAD, aBot = cBot - sh('sofa_red') - 4;
    const rug = document.createElement('div'); rug.className = 'rug';
    rug.style.left = Math.round(aX - 1 * s) + 'px';
    rug.style.top = Math.round(aBot - 13 * s) + 'px';
    rug.style.width = Math.round(42 * s) + 'px';
    rug.style.height = Math.round(24 * s) + 'px';
    $decor.appendChild(rug);
    if (sp.sofa_gray) add('sofa_gray', aX + 1 * s, aBot - 11 * s, 2);   // 后左竖臂
    add('sofa_red', aX + 16 * s, aBot - 1 * s, 2);                      // 前右横臂(错位 → L 角, 非并排)
    add('cat', aX + 5 * s, aBot + 4 * s, 3);                            // 趴 L 内凹处地毯, 不压沙发
    add('corgi', aX + 10 * s, aBot + 6 * s, 3);

    // ── B 茶水间(底右角): counter 角 + vending2 立其端 + 角落绿植烘暖 ──
    const counterLeft = W - sw('counter') - PAD;
    const bBot = cBot - sh('counter') - 4;
    add('counter', counterLeft, bBot, 2);
    add('vending2', counterLeft - sw('vending2') + 2 * s, bBot - (sh('vending2') - sh('counter')), 2);
    add('plant_tall', W - sw('plant_tall') - PAD, bBot - sh('plant_tall') - 1 * s, 1);

    // ── C 绿植/洽谈角(右侧 desk 列右侧, 填右半空白 P1#18): 绿植+小长椅 紧凑成组(竖向, 离桌 ≥0.75CELL) ──
    const cX = deskRight + CLEAR;
    if (cX + sw('plant_tall') < W - PAD) {
      add('plant_tall', cX, L.desksTop + 2 * s, 1);
      if (sp.bench_sm) add('bench_sm', cX, L.desksTop + 22 * s, 1);
      add('plant_tall', cX + 2 * s, L.desksTop + 38 * s, 1);
    }

    // ── D 左侧收边绿植(左 desk 列左侧, 与 A 错开; 离桌 ≥0.75CELL) ──
    const dX = L.deskLeft0 - sw('plant_tall') - CLEAR;
    if (dX > PAD) {
      add('plant_tall', dX, L.desksTop + 4 * s, 1);
      add('plant_tall', dX, L.desksTop + L.deskBlockH - sh('plant_tall'), 1);
    }
  }

  // ---------- boss 主位(独立渲染分支: 不经 makeStation/updateStation, 无状态/无浮标/无强度) ----------
  function renderBoss(boss, L) {
    $lounge.innerHTML = '';
    if (!boss) return;
    const sp = S.atlas.sprites;
    const [pw, ph] = S.people.cell;
    const cx = L.bossCX, top = L.bossSeatTop, s = SCALE;

    const mk = (key, img, coords, left, t, z) => {
      const el = mkSpr(key, img, coords);
      el.style.left = Math.round(left) + 'px'; el.style.top = Math.round(t) + 'px';
      el.style.zIndex = z; $lounge.appendChild(el); return el;
    };
    const div = (cls, left, t, w, h, z) => {
      const el = document.createElement('div'); el.className = cls;
      el.style.left = Math.round(left) + 'px'; el.style.top = Math.round(t) + 'px';
      if (w != null) el.style.width = Math.round(w) + 'px';
      if (h != null) el.style.height = Math.round(h) + 'px';
      if (z != null) el.style.zIndex = z;
      $lounge.appendChild(el); return el;
    };

    // 大班桌几何(≥1.4× 员工桌): 盖住 boss 下半身, 比员工桌更宽更厚
    const deskW = 44 * s, deskH = 12 * s, deskTop = top + 8 * s, deskLeft = cx - deskW / 2;

    // 层级(从下到上): 暖地毯 → 大班椅 → boss 半身 → 大班桌 → 桌前铭牌 → 桌上小物
    // 暖地毯(纯装饰不发光, 略宽于桌作区域锚)
    const rugW = 50 * s, rugH = 9 * s;
    div('boss-rug', cx - rugW / 2, top + 9 * s, rugW, rugH, 0);
    // 两侧绿植围区
    mk('decor-plant_tall', imgs.atlas, sp.plant_tall, cx - 30 * s, top - 2 * s, 1);
    mk('decor-plant_tall', imgs.atlas, sp.plant_tall, cx + 20 * s, top - 2 * s, 1);
    // 大班椅 + boss 半身
    const chairW = sp.chair_white[2] * s;
    mk('chair', imgs.atlas, sp.chair_white, cx - chairW / 2, top + 2 * s, 2);
    const bcol = (S.people.order.indexOf('p2_auburn') + 0) % S.people.order.length;
    mk('person', imgs.people, [(bcol < 0 ? 0 : bcol) * pw, 0, pw, ph], cx - (pw * s) / 2, top - 2 * s, 3);
    // 大班桌(CSS 木桌, 盖下半身)
    div('boss-desk', deskLeft, deskTop, deskW, deskH, 4);
    // 桌上小物(老板办公桌非工位: 暖光台灯 + 合盖笔记本; 无 status 屏)
    div('boss-lamp', deskLeft + 5 * s, deskTop - 4 * s, null, null, 5);
    div('boss-laptop', deskLeft + deskW - 15 * s, deskTop - 2 * s, null, null, 5);
    // 桌前立面铭牌(替代孤立飘牌)
    const plate = div('boss-plate', cx, deskTop + deskH - 7 * s, null, null, 5);
    plate.textContent = boss.name;
    // 点选区
    const hit = div('boss-hit', cx - 24 * s, top - 4 * s, 48 * s, 26 * s, 6);
    hit.addEventListener('click', () => selectAgent(boss.name));
  }

  // ---------- 工位 ----------
  function makeStation(agent, idx, desks) {
    const el = document.createElement('div');
    el.className = 'station';
    el.dataset.name = agent.name;

    const tile = document.createElement('div'); tile.className = 'tile';
    el.appendChild(tile);

    // 椅子（暖色循环）
    const chairKeys = ['chair_orange', 'chair_yellow', 'chair_green', 'chair_blue', 'chair_white'];
    const chair = mkSpr('chair', imgs.atlas, S.atlas.sprites[chairKeys[idx % chairKeys.length]]);
    el.appendChild(chair);

    // 小人半身：lead 用 leadSuggest，其余从剩余列里唯一分配（避免撞脸）
    const order = S.people.order;
    const leadCol = order.indexOf(S.people.leadSuggest);
    let col;
    if (agent.lead && leadCol >= 0) {
      col = leadCol;
    } else {
      const others = order.map((_, i) => i).filter((i) => i !== leadCol);
      const rank = desks.filter((a, i) => i < idx && !a.lead).length;
      col = others.length ? others[rank % others.length] : (idx % order.length);
    }
    const [pw, ph] = S.people.cell;
    const person = mkSpr('person', imgs.people, [col * pw, 0, pw, ph]);
    person.dataset.col = col;
    el.appendChild(person);

    // 工位（木桌+显示器，状态列）
    const ws = mkSpr('ws', imgs.workstation, [0, 0, WS_W, WS_H]);
    el.appendChild(ws);

    if (agent.lead) {
      const crown = document.createElement('div');
      crown.className = 'crown';
      el.appendChild(crown);
    }

    const floater = document.createElement('div'); floater.className = 'floater hidden';
    el.appendChild(floater);

    const name = document.createElement('div'); name.className = 'name';
    name.textContent = agent.name;
    el.appendChild(name);

    el.addEventListener('click', () => selectAgent(agent.name));
    $desks.appendChild(el);
    const rec = { el, tile, person, ws, floater, col };
    stations.set(agent.name, rec);
    return rec;
  }

  function positionStation(el, idx, L) {
    const r = Math.floor(idx / L.perRow), c = idx % L.perRow;
    // 每行居中(末行不足列数时也居中, 不左挤)
    const itemsInRow = (r < L.rows - 1) ? L.perRow : (L.deskCount - L.perRow * (L.rows - 1));
    const rowW = itemsInRow * STA_W + (itemsInRow - 1) * GAP_X;
    const rowLeft = Math.round((L.roomW - rowW) / 2);
    el.style.left = (rowLeft + c * (STA_W + GAP_X)) + 'px';
    el.style.top = (L.desksTop + r * (STA_H + GAP_Y)) + 'px';
  }

  function updateStation(rec, agent, vis) {
    const el = rec.el;
    el.classList.remove('s-offline', 's-launching', 's-stuck', 'b1', 'b2', 'b3');
    if (vis === 'offline') el.classList.add('s-offline');
    if (vis === 'stuck') el.classList.add('s-stuck');
    if (agent.status === 'launching') el.classList.add('s-launching');

    // 繁忙强度分档(仅 busy 内部子维度: 队列越长动得越凶; 升即时/降 1s 迟滞)
    if (vis === 'busy') {
      const tier = busyTierFor(agent.name, agent.queue);
      if (tier > 0) el.classList.add('b' + tier);
    } else {
      busyTierShown[agent.name] = 0; busyDownSince[agent.name] = 0;
    }

    // 工位屏幕状态列
    const wsCol = S.workstation.states[vis] ?? 0;
    rec.ws.style.setProperty('--bx', wsCol * WS_W);

    // 脚下 tile 发光
    rec.tile.className = 'tile ' + vis;

    // 头顶浮标：busy=实心圆(CSS 形状); stuck=三角!; offline=空心✕; waiting…/done✓ 圆角矩形。
    // 字形与图例同走 floaterGlyph()(单一事实源 sprites.json.status[*].floater)。
    const f = floaterKey(vis);
    if (f) {
      rec.floater.textContent = FLOATER_GLYPH[f] || '';
      rec.floater.className = 'floater ' + vis;
    } else {
      rec.floater.className = 'floater hidden';
    }

    // 打字微动：busy 用 type 帧（行1），其余 rest（行0）
    const [, ph] = S.people.cell;
    const typing = vis === 'busy';
    const row = (typing && frame) ? S.people.frames.type : S.people.frames.rest;
    rec.person.style.setProperty('--by', row * ph);

    el.classList.toggle('sel', selected === agent.name);
  }

  // ---------- 说话气泡(独立 #bubbles 层: 不挂 .person/.station → 不被繁忙抖动/jolt 晃; 含 boss) ----------
  // 头顶锚点(stage 坐标): 返回 {x: 头顶中线, y: 气泡底边(浮标带之上)}; 非在屏→null。
  function bubbleAnchor(name) {
    if (name === 'boss' && bossOnScreen && curL) {
      return { x: curL.bossCX, y: curL.bossSeatTop - 10 };       // boss 头顶上方(无浮标)
    }
    const rec = stations.get(name);
    if (!rec) return null;
    const left = parseFloat(rec.el.style.left) || 0, top = parseFloat(rec.el.style.top) || 0;
    return { x: left + STA_W / 2, y: top - 9 * SCALE };          // 浮标顶(top-7s)之上, 留 ≥2px
  }

  function positionBubble(b, anchor) {
    const halfW = (b.offsetWidth || 80) / 2;
    const roomW = curL ? curL.roomW : 0, roomH = curL ? curL.roomH : 0;
    let cx = anchor.x;
    cx = Math.max(4 + halfW, Math.min(roomW - 4 - halfW, cx));   // 整体平移回舞台(≥4px 边距)
    b.style.left = Math.round(cx - halfW) + 'px';
    b.style.bottom = Math.round(roomH - anchor.y) + 'px';
    b.style.setProperty('--tail-dx', Math.round(anchor.x - cx) + 'px');  // 尾巴仍指说话人
  }

  function fadeOutBubble(name) {
    const st = bubbleState[name];
    if (!st || !st.el) return;
    const el = st.el;
    el.classList.add('fade');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 260);
    bubbleState[name] = null;
  }

  function showBubble(name, body) {
    const anchor = bubbleAnchor(name);
    if (!anchor) return;                                          // 非在屏不弹
    const text = body.length > 48 ? body.slice(0, 47) + '…' : body;
    let st = bubbleState[name];
    let b;
    if (st && st.el && st.el.isConnected) {                       // 同人已有气泡 → 替换文本(只显最新, 不排队)
      b = st.el; b.classList.remove('fade');
    } else {
      b = document.createElement('div'); b.className = 'bubble';
      $bubbles.appendChild(b);
      b.style.animation = 'bubble-pop .15s steps(3, end)';        // pop 仅新气泡
      st = bubbleState[name] = { el: b, timer: 0 };
    }
    b.textContent = text;
    positionBubble(b, anchor);                                    // 量 offsetWidth 后定位+夹边
    const dwell = Math.max(2500, Math.min(6000, 2500 + 35 * text.length));
    clearTimeout(st.timer);
    st.timer = setTimeout(() => fadeOutBubble(name), dwell);
  }

  // 每次重绘按当前头顶坐标重定位活动气泡(防 roster 重排/缩放后气泡飘离头顶); 说话人离屏则移除。
  function repositionBubbles() {
    for (const name in bubbleState) {
      const st = bubbleState[name];
      if (!st || !st.el || !st.el.isConnected) continue;
      const anchor = bubbleAnchor(name);
      if (anchor) positionBubble(st.el, anchor);
      else { clearTimeout(st.timer); st.el.remove(); bubbleState[name] = null; }
    }
  }

  // 未选中态：团队概览 + 常驻状态图例(图例小样与场内浮标同款)
  function renderOverview() {
    if (!state) return;
    const qFroms = new Set(state.questions.map((q) => q.from));
    const counts = { idle:0, busy:0, waiting:0, stuck:0, offline:0 };
    for (const a of state.roster) {
      if (a.virtual || isBoss(a)) continue;       // boss 坐镇 / 纯装饰虚拟(intern) 不计入状态统计
      const v = visualState(a, qFroms);
      if (counts[v] != null) counts[v]++;            // done 瞬态不计入概览
    }
    const order = ['idle', 'busy', 'waiting', 'stuck', 'offline'];
    $ovStats.innerHTML = order.map((k) =>
      '<span class="ov-stat ' + k + '"><b>' + counts[k] + '</b> ' + esc(T.stat[k]) + '</span>'
    ).join('<i class="ov-dot">·</i>');

    // 图例小样: 形(.floater.<state> 同 CSS) + 字形(floaterGlyph 同事实源) + 色(var(--state)) 三处与场内同款
    const legend = ['busy', 'idle', 'waiting', 'stuck', 'done', 'offline'];
    $ovLegend.innerHTML = legend.map((k) =>
      '<li><span class="lg-ico floater ' + k + '">' + esc(floaterGlyph(k)) + '</span>' +
      '<span class="lg-label">' + esc(T.st[k]) + '</span></li>'
    ).join('');
  }

  // ---------- 详情面板 ----------
  function selectAgent(name) {
    selected = name;
    try { history.replaceState(null, '', '#sel=' + encodeURIComponent(name)); } catch (e) { /* ignore */ }
    stations.forEach((rec, n) => rec.el.classList.toggle('sel', n === name));
    renderPanel();
  }

  function showOverview() {
    $panel.classList.add('empty');
    document.getElementById('panel-body').classList.add('hidden');
    $overview.classList.remove('hidden');
    renderOverview();
  }

  function renderPanel() {
    if (!selected || !state) { showOverview(); return; }
    const agent = state.roster.find((a) => a.name === selected);
    if (!agent) { showOverview(); return; }
    $panel.classList.remove('empty');
    $overview.classList.add('hidden');
    document.getElementById('panel-body').classList.remove('hidden');

    const qFroms = new Set(state.questions.map((q) => q.from));
    document.getElementById('panel-name').textContent = agent.name;
    const pill = document.getElementById('panel-status');
    const $done = document.getElementById('panel-done');
    const $q = document.getElementById('panel-q');
    document.getElementById('panel-role').textContent = (T.role + '：') + (agent.role || '—');

    if (isBoss(agent)) {
      // boss 坐镇: 中性标(非状态色), 不参与 6 态/强度, 无待答/无完成时间
      pill.textContent = T.boss;
      pill.className = 'status-pill boss';
      $done.classList.add('hidden');
      $q.classList.add('hidden');
    } else {
      const vis = visualState(agent, qFroms);
      pill.textContent = statusLabel(vis);
      pill.className = 'status-pill ' + vis;
      // 上次完成时间(即便错过 done 动画也能查)
      if (lastDoneAt[selected]) {
        $done.classList.remove('hidden');
        $done.textContent = '✓ ' + T.lastDone + '：' + fmtTime(lastDoneAt[selected]);
      } else {
        $done.classList.add('hidden');
      }
      // 待答问题
      const myQ = state.questions.filter((q) => q.from === selected);
      if (myQ.length) {
        $q.classList.remove('hidden');
        $q.innerHTML = '<div class="q-title">' + T.waiting + '</div>' +
          myQ.map((q) => '<div>' + esc(q.question) + '</div>' +
            (q.options || []).map((o) => '<div class="q-opt">· ' + esc(o) + '</div>').join('')).join('');
      } else {
        $q.classList.add('hidden');
      }
    }

    // 相关消息：from==name || to==name
    const $ul = document.getElementById('panel-msgs');
    const msgs = state.log.filter((m) => m.from === selected || m.to === selected).slice(-25);
    if (!msgs.length) {
      $ul.innerHTML = '<li class="m-empty">' + T.noMessages + '</li>';
    } else {
      $ul.innerHTML = msgs.map((m) =>
        '<li><div class="m-head"><span class="m-route">' + esc(m.from) + ' → ' + esc(m.to) +
        '</span><span class="m-time">' + fmtTime(m.ts) + '</span></div>' +
        '<div class="m-body">' + esc(m.body) + '</div></li>').join('');
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }

  // ---------- 渲染一帧状态 ----------
  function render() {
    if (!state || !S) return;
    const roster = state.roster;
    const bossAgent = roster.find((a) => isBoss(a));
    // 只渲染 ①真实工位成员(含 offline,留在工位屏黑灰) ②boss 主位; 其余纯装饰虚拟(intern 等)不渲染小人
    const desks = roster.filter((a) => !a.virtual && !isBoss(a));

    $empty.classList.toggle('hidden', roster.length > 0);

    const L = layoutRoom(desks.length, !!bossAgent);
    curL = L;
    bossOnScreen = !!bossAgent;

    // done 闪：检测 busy→idle(boss 不参与状态, 跳过)
    for (const a of roster) {
      if (isBoss(a)) continue;
      const prev = prevStatus[a.name];
      if (prev === 'busy' && a.status === 'idle') {
        doneUntil[a.name] = Date.now() + DONE_MS;
        lastDoneAt[a.name] = Date.now();
      }
      prevStatus[a.name] = a.status;
    }

    const qFroms = new Set(state.questions.map((q) => q.from));

    // 增删工位(boss 与其它虚拟不建工位)
    const want = new Set(desks.map((a) => a.name));
    for (const [name, rec] of stations) {
      if (!want.has(name)) { rec.el.remove(); stations.delete(name); }
    }
    desks.forEach((a, idx) => {
      let rec = stations.get(a.name);
      if (!rec) rec = makeStation(a, idx, desks);
      positionStation(rec.el, idx, L);
      updateStation(rec, a, visualState(a, qFroms));
    });

    if (!booted) booted = true;
    buildDecor(L);
    renderBoss(bossAgent, L);
    renderPanel();
    repositionBubbles();      // 重排后按当前头顶坐标重定位活动气泡
    fitStage();
  }

  // 仅打字帧刷新（不重排）
  function tickFrame() {
    frame ^= 1;
    if (!state || !S) return;
    const qFroms = new Set(state.questions.map((q) => q.from));
    const [, ph] = S.people.cell;
    for (const a of state.roster) {
      const rec = stations.get(a.name);
      if (!rec) continue;
      const vis = visualState(a, qFroms);
      if (vis === 'busy') {
        rec.person.style.setProperty('--by', (frame ? S.people.frames.type : S.people.frames.rest) * ph);
      }
    }
  }

  // ---------- 轮询 ----------
  function onScreen(name) {                       // 在屏说话人: 工位成员 或 boss 主位(其余未渲染虚拟不弹)
    return stations.has(name) || (name === 'boss' && bossOnScreen);
  }
  function diffBubbles() {
    if (!state) return;
    for (const m of state.log) {
      const prev = lastMsgTs[m.from] || 0;
      if (m.ts <= prev) continue;
      lastMsgTs[m.from] = m.ts;
      if (onScreen(m.from)) showBubble(m.from, m.body);   // 只弹 from 且在屏(含 boss)
    }
  }

  function seedLastTs() {
    if (!state) return;
    for (const m of state.log) lastMsgTs[m.from] = Math.max(lastMsgTs[m.from] || 0, m.ts);
  }

  async function poll() {
    try {
      const r = await fetch('state', { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
      const data = await r.json();
      const first = state === null;
      state = data;
      misses = 0;
      $banner.classList.add('hidden');
      $stageWrap.classList.remove('stale');
      render();
      if (first) seedLastTs(); else diffBubbles();
    } catch (e) {
      misses++;
      if (misses >= MAX_MISS) {
        $banner.classList.remove('hidden');
        $stageWrap.classList.add('stale');
      }
    }
  }

  // ---------- 启动 ----------
  async function boot() {
    try {
      S = await fetch(ASSETS + 'sprites.json', { cache: 'no-store' }).then((r) => r.json());
    } catch (e) {
      $banner.textContent = 'sprites.json 加载失败';
      $banner.classList.remove('hidden');
      return;
    }
    // 注入调色板到 CSS 变量
    const root = document.documentElement.style;
    const p = S.palette || {};
    const map = { tileA:'tileA', tileB:'tileB', seam:'seam', wood:'wood', woodHi:'woodHi', woodLo:'woodLo', base:'base',
                  busy:'busy', waiting:'waiting', stuck:'stuck', done:'done', offline:'offline', idle:'idle', warmGlow:'warmGlow' };
    for (const k in map) if (p[k]) root.setProperty('--' + map[k], p[k]);
    root.setProperty('--s', SCALE);

    const [people, ws, wall, atlas] = await Promise.all([
      loadImg(ASSETS + S.people.image),
      loadImg(ASSETS + S.workstation.image),
      loadImg(ASSETS + S.wall.image),
      loadImg(ASSETS + S.atlas.image),
    ]);
    imgs = { people, workstation: ws, wall, atlas };

    // 深链：#sel=<name> 预选某成员（分享/直达详情）
    const m = /(?:^|#|&)sel=([^&]+)/.exec(location.hash);
    if (m) { try { selected = decodeURIComponent(m[1]); } catch (e) { selected = m[1]; } }

    await poll();
    setInterval(poll, POLL_MS);
    setInterval(tickFrame, FRAME_MS);

    // 窗口缩放时重新 fit(debounce 100ms)
    let rzT = null;
    window.addEventListener('resize', () => {
      clearTimeout(rzT);
      rzT = setTimeout(fitStage, 100);
    });
  }

  boot();
})();

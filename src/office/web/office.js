/* falinks 像素办公室 — 渲染与轮询（只读）。
   数据：GET /office/state（1s 轮询）。素材清单：assets/sprites.json（单一事实源）。
   状态两级冗余：一级=脚下 tile 染色发光，二级=头顶形状浮标。 */
(() => {
  'use strict';

  const ASSETS = 'assets/';
  const POLL_MS = 1000;
  const FRAME_MS = 250;          // 打字微动 ~4fps
  const BUBBLE_MS = 4500;
  const DONE_MS = 1500;          // busy→idle 短暂 done 闪
  const MAX_MISS = 2;            // 连续轮询失败数后判定断连

  // ---- i18n（内联小词典，?lang= 切换；key 对齐 zh/en） ----
  const LANG = (new URLSearchParams(location.search).get('lang') || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
  const T = {
    zh: { subtitle: '像素办公室', empty: '暂无成员', hint: '点击工位查看详情', disconnected: '连接已断开，正在重试…',
          role: '角色', messages: '相关消息', waiting: '待回答', noMessages: '暂无相关消息',
          st: { idle:'空闲', busy:'忙碌', waiting:'等待', done:'完成', offline:'离线' } },
    en: { subtitle: 'Pixel Office', empty: 'No members', hint: 'Click a desk for details', disconnected: 'Disconnected — retrying…',
          role: 'Role', messages: 'Related messages', waiting: 'Awaiting answer', noMessages: 'No related messages',
          st: { idle:'Idle', busy:'Busy', waiting:'Waiting', done:'Done', offline:'Offline' } },
  }[LANG];

  document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';
  document.getElementById('subtitle').textContent = T.subtitle;
  document.getElementById('empty').textContent = T.empty;
  document.getElementById('panel-hint').textContent = T.hint;
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
  const $empty = document.getElementById('empty');
  const $banner = document.getElementById('banner');
  const $panel = document.getElementById('panel');

  // ---- 几何（与 SPRITE-SPEC 一致） ----
  const SCALE = 4;
  const CELL = 16 * SCALE;       // 地砖像素
  const WS_W = 36, WS_H = 22;    // workstation cell
  const STA_W = WS_W * SCALE;    // 工位占位宽
  const STA_H = 28 * SCALE;      // 6 头顶 + 22 工位
  const GAP_X = 30, GAP_Y = 46;  // 工位间距
  const COLS = 5;                // 每行工位数
  const PAD = 28;                // 房间内边距
  const WALL_H = 40 * SCALE;     // 后墙带高
  const COMMONS_H = 150;         // 工位下方公共休息带高

  let S = null;                  // sprites.json
  let imgs = {};                 // 预加载图（含 naturalWidth/Height）
  let state = null;              // 最近一次 /office/state
  let selected = null;           // 选中成员名
  let frame = 0;                 // 打字帧
  let misses = 0;                // 连续失败计数
  let booted = false;
  const lastMsgTs = {};          // name -> 最近一次已展示气泡的消息 ts
  const bubbleTimers = {};       // name -> timeout
  const doneUntil = {};          // name -> ts(ms) done 闪结束时刻
  const prevStatus = {};         // name -> 上次原始 status
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

  // ---- 原始 roster status → 5 态视觉 ----
  function visualState(agent, questionFroms) {
    const raw = agent.status;
    if (raw === 'dead') return 'offline';
    if (questionFroms.has(agent.name)) return 'waiting';     // 该员工有待答问题
    if (raw === 'stuck' || agent.unresponsive) return 'waiting';
    if (raw === 'busy') return 'busy';
    if (raw === 'launching') return 'idle';
    // busy→idle 的短暂 done 闪
    if (doneUntil[agent.name] && Date.now() < doneUntil[agent.name]) return 'done';
    return 'idle';
  }

  function statusLabel(v) { return T.st[v] || v; }
  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---------- 静态房间 ----------
  function layoutRoom(deskCount) {
    const rows = Math.max(1, Math.ceil(deskCount / COLS));
    const perRow = Math.min(COLS, Math.max(1, deskCount));
    const w = PAD * 2 + perRow * STA_W + (perRow - 1) * GAP_X;
    const floorTop = WALL_H * 0.62;                 // 地面从墙裙处接上
    const deskBlock = rows * (STA_H + GAP_Y);
    const commonsTop = floorTop + 20 + deskBlock;   // 工位下方的公共休息带
    const h = commonsTop + COMMONS_H;
    const W = Math.max(w, 760), Hh = Math.max(h, 460);

    $stage.style.width = W + 'px';
    $stage.style.height = Hh + 'px';
    $stage.style.setProperty('--cell', CELL + 'px');

    $wall.style.height = WALL_H + 'px';
    $wall.style.backgroundImage = `url(${imgs.wall.src})`;
    $wall.style.backgroundSize = `${imgs.wall.naturalWidth * SCALE}px ${WALL_H}px`;

    $floor.style.top = floorTop + 'px';
    $floor.style.backgroundSize = `${CELL * 2}px ${CELL * 2}px`;
    return { W, floorTop, perRow, commonsTop };
  }

  // 装饰只放在「墙上」与「工位下方公共带」，绝不与工位行重叠。
  function buildDecor(W, floorTop, commonsTop) {
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
    const cy = commonsTop + 24;                      // 公共带基线
    // 墙上窗（采暖光）
    add('win_blue1', W * 0.14, WALL_H * 0.16);
    add('win_blue2', W * 0.14 + (sp.win_blue1[2] + 6) * SCALE, WALL_H * 0.16);
    add('win_tall', W * 0.72, WALL_H * 0.1);
    // 公共带：绿植 / 贩卖机 / 猫狗 横向铺开，互不重叠
    add('plant_tall', PAD, cy - 6 * SCALE);
    add('vending1', W - sw('vending1') - PAD, cy - 12 * SCALE);
    add('cat', W * 0.30, cy + 22 * SCALE);
    add('corgi', W * 0.42, cy + 26 * SCALE);
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

  function positionStation(el, idx, perRow, floorTop) {
    const r = Math.floor(idx / perRow), c = idx % perRow;
    el.style.left = (PAD + c * (STA_W + GAP_X)) + 'px';
    el.style.top = (floorTop + 20 + r * (STA_H + GAP_Y)) + 'px';
  }

  function updateStation(rec, agent, vis) {
    const el = rec.el;
    el.classList.remove('s-offline', 's-launching');
    if (vis === 'offline') el.classList.add('s-offline');
    if (agent.status === 'launching') el.classList.add('s-launching');

    // 工位屏幕状态列
    const wsCol = S.workstation.states[vis] ?? 0;
    rec.ws.style.setProperty('--bx', wsCol * WS_W);

    // 脚下 tile 发光
    rec.tile.className = 'tile ' + vis;

    // 头顶浮标：busy=实心圆(CSS 形状,无字形)；waiting…/done✓/offline! 用字形,均带深描边底
    const f = S.status[vis] && S.status[vis].floater;
    const glyph = { dots: '…', check: '✓', bang: '!' };
    if (f) {
      rec.floater.textContent = glyph[f] || '';
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

  // ---------- 休息区（虚拟成员，如 boss） ----------
  function renderLounge(virtuals, W, commonsTop) {
    $lounge.innerHTML = '';
    if (!virtuals.length) return;
    // 沙发置于公共带中部，远离工位行
    const sofa = mkSpr('decor-sofa', imgs.atlas, S.atlas.sprites.sofa_red);
    const sofaLeft = Math.round(W * 0.5 - (S.atlas.sprites.sofa_red[2] * SCALE) / 2);
    const sofaTop = commonsTop + 18;
    sofa.style.left = sofaLeft + 'px';
    sofa.style.top = sofaTop + 'px';
    sofa.style.zIndex = 1;
    $lounge.appendChild(sofa);

    const [pw, ph] = S.people.cell;
    virtuals.forEach((a, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'lounge-item';
      wrap.style.left = (sofaLeft + (6 + i * (pw + 2)) * SCALE) + 'px';
      wrap.style.top = (sofaTop - (ph - 4) * SCALE) + 'px';
      wrap.style.zIndex = 2;
      const col = (S.people.order.indexOf('p2_auburn') + i) % S.people.order.length;
      const person = mkSpr('person', imgs.people, [(col < 0 ? 0 : col) * pw, 0, pw, ph]);
      wrap.appendChild(person);
      const name = document.createElement('div'); name.className = 'name'; name.textContent = a.name;
      wrap.appendChild(name);
      wrap.addEventListener('click', () => selectAgent(a.name));
      $lounge.appendChild(wrap);
    });
  }

  // ---------- 气泡 ----------
  function showBubble(name, body) {
    const rec = stations.get(name);
    if (!rec) return;
    const old = rec.el.querySelector('.bubble');
    if (old) old.remove();
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = body.length > 60 ? body.slice(0, 58) + '…' : body;
    rec.el.appendChild(b);
    clearTimeout(bubbleTimers[name]);
    bubbleTimers[name] = setTimeout(() => b.remove(), BUBBLE_MS);
  }

  // ---------- 详情面板 ----------
  function selectAgent(name) {
    selected = name;
    try { history.replaceState(null, '', '#sel=' + encodeURIComponent(name)); } catch (e) { /* ignore */ }
    stations.forEach((rec, n) => rec.el.classList.toggle('sel', n === name));
    renderPanel();
  }

  function renderPanel() {
    if (!selected || !state) { $panel.classList.add('empty'); document.getElementById('panel-body').classList.add('hidden'); return; }
    const agent = state.roster.find((a) => a.name === selected);
    if (!agent) { $panel.classList.add('empty'); document.getElementById('panel-body').classList.add('hidden'); return; }
    $panel.classList.remove('empty');
    document.getElementById('panel-body').classList.remove('hidden');

    const qFroms = new Set(state.questions.map((q) => q.from));
    const vis = visualState(agent, qFroms);
    document.getElementById('panel-name').textContent = agent.name;
    const pill = document.getElementById('panel-status');
    pill.textContent = statusLabel(vis);
    pill.className = 'status-pill ' + vis;
    document.getElementById('panel-role').textContent = (T.role + '：') + (agent.role || '—');

    // 待答问题
    const $q = document.getElementById('panel-q');
    const myQ = state.questions.filter((q) => q.from === selected);
    if (myQ.length) {
      $q.classList.remove('hidden');
      $q.innerHTML = '<div class="q-title">' + T.waiting + '</div>' +
        myQ.map((q) => '<div>' + esc(q.question) + '</div>' +
          (q.options || []).map((o) => '<div class="q-opt">· ' + esc(o) + '</div>').join('')).join('');
    } else {
      $q.classList.add('hidden');
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
    const desks = roster.filter((a) => !a.virtual);
    const virtuals = roster.filter((a) => a.virtual);

    $empty.classList.toggle('hidden', roster.length > 0);

    const { W, floorTop, perRow, commonsTop } = layoutRoom(desks.length);

    // done 闪：检测 busy→idle
    for (const a of roster) {
      const prev = prevStatus[a.name];
      if (prev === 'busy' && a.status === 'idle') doneUntil[a.name] = Date.now() + DONE_MS;
      prevStatus[a.name] = a.status;
    }

    const qFroms = new Set(state.questions.map((q) => q.from));

    // 增删工位
    const want = new Set(desks.map((a) => a.name));
    for (const [name, rec] of stations) {
      if (!want.has(name)) { rec.el.remove(); stations.delete(name); }
    }
    desks.forEach((a, idx) => {
      let rec = stations.get(a.name);
      if (!rec) rec = makeStation(a, idx, desks);
      positionStation(rec.el, idx, perRow, floorTop);
      updateStation(rec, a, visualState(a, qFroms));
    });

    if (!booted) booted = true;
    buildDecor(W, floorTop, commonsTop);
    renderLounge(virtuals, W, commonsTop);
    renderPanel();
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
  function diffBubbles() {
    if (!state) return;
    for (const m of state.log) {
      const prev = lastMsgTs[m.from] || 0;
      if (m.ts > prev && stations.has(m.from)) {
        lastMsgTs[m.from] = m.ts;
        showBubble(m.from, m.body);
      } else if (m.ts > (lastMsgTs[m.from] || 0)) {
        lastMsgTs[m.from] = m.ts;          // 虚拟成员等无工位的，仅记录不冒泡
      }
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
    const map = { tileA:'tileA', tileB:'tileB', seam:'seam', wood:'wood', woodLo:'woodLo', base:'base',
                  busy:'busy', waiting:'waiting', done:'done', offline:'offline', idle:'idle', warmGlow:'warmGlow' };
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
  }

  boot();
})();

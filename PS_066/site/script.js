/* =====================================================================
   OceanEmbed — interactive showcase engine
   Team SANKALP #777 · Smart India Hackathon 2026 · PS 26066
   No external libraries. Canvas 2D only.
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------- helpers ------------------------------ */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const D = window.OE_DATA || null;
  const NDAY = D ? D.days.length : 0;
  const NDEP = D ? D.depths.length : 0;
  const NLAT = D ? D.lat.length : 0;
  const NLON = D ? D.lon.length : 0;

  /* ---------------------------- turbo colormap -------------------------- */
  /* 33-stop sample of the exact 256-entry turbo LUT shipped with the repo. */
  const TURBO = [
    [48,18,59],[57,41,114],[64,64,161],[68,86,199],[70,107,227],[70,127,246],[65,147,254],[54,168,249],
    [40,187,235],[28,205,215],[23,220,194],[30,232,175],[50,241,151],[77,249,124],[109,253,98],[139,254,75],
    [164,252,59],[182,247,53],[202,237,51],[221,224,54],[236,209,57],[247,192,57],[252,174,52],[254,152,44],
    [251,128,34],[245,104,23],[236,82,14],[224,64,8],[210,48,5],[192,35,2],[172,22,1],[148,12,1],[122,4,2]
  ];
  const LUT_N = 512;
  const LUT = new Uint8Array(LUT_N * 3);
  (function buildLUT() {
    for (let i = 0; i < LUT_N; i++) {
      const f = (i / (LUT_N - 1)) * (TURBO.length - 1);
      const a = Math.min(Math.floor(f), TURBO.length - 2);
      const t = f - a, A = TURBO[a], B = TURBO[a + 1];
      LUT[i * 3] = A[0] + (B[0] - A[0]) * t;
      LUT[i * 3 + 1] = A[1] + (B[1] - A[1]) * t;
      LUT[i * 3 + 2] = A[2] + (B[2] - A[2]) * t;
    }
  })();
  function lutAt(t) {
    const i = Math.round(clamp(t, 0, 1) * (LUT_N - 1)) * 3;
    return 'rgb(' + LUT[i] + ',' + LUT[i + 1] + ',' + LUT[i + 2] + ')';
  }
  function lutRGB(t) {
    const i = Math.round(clamp(t, 0, 1) * (LUT_N - 1)) * 3;
    return [LUT[i], LUT[i + 1], LUT[i + 2]];
  }

  /* ----------------------- held-out metrics (61 days) ------------------- */
  const METRICS = [
    { d: 0.5,   rmse: 0.50, bias: -0.16, base: 2.29, acc: 0.75 },
    { d: 5.1,   rmse: 0.58, bias: -0.37, base: 2.33, acc: 0.75 },
    { d: 9.6,   rmse: 0.58, bias: -0.38, base: 2.29, acc: 0.75 },
    { d: 18.5,  rmse: 0.60, bias: -0.42, base: 2.18, acc: 0.72 },
    { d: 29.4,  rmse: 0.75, bias: -0.57, base: 1.95, acc: 0.53 },
    { d: 47.4,  rmse: 0.74, bias: -0.45, base: 1.25, acc: 0.42 },
    { d: 77.9,  rmse: 0.65, bias:  0.17, base: 1.21, acc: 0.85 },
    { d: 92.3,  rmse: 0.87, bias:  0.35, base: 1.66, acc: 0.88 },
    { d: 130.7, rmse: 0.98, bias:  0.47, base: 1.91, acc: 0.90 },
    { d: 155.9, rmse: 0.83, bias:  0.38, base: 1.64, acc: 0.89 },
    { d: 186.1, rmse: 0.64, bias:  0.27, base: 1.25, acc: 0.89 },
    { d: 318.1, rmse: 0.29, bias:  0.10, base: 0.41, acc: 0.70 },
    { d: 541.1, rmse: 0.19, bias:  0.04, base: 0.27, acc: 0.56 },
    { d: 643.6, rmse: 0.19, bias:  0.02, base: 0.25, acc: 0.53 },
    { d: 902.3, rmse: 0.19, bias:  0.00, base: 0.22, acc: 0.53 }
  ];

  const DEPTHS = D ? D.depths : METRICS.map(m => m.d);
  const DAYS = D ? D.days : [];

  /* --------------------------- data accessors --------------------------- */
  function cellValid(d, i, j) { return D.mask[d][i][j] > 0; }

  function valueAt(day, d, i, j, field) {
    if (!cellValid(d, i, j)) return null;
    const p = D.pred[day][d][i][j] / 100;
    if (field === 'pred') return p;
    const t = D.truth[day][d][i][j] / 100;
    if (field === 'truth') return t;
    return Math.abs(p - t);
  }

  /* Bilinear sample of a field over the (lon,lat) grid, mask-aware. */
  function sampleField(day, d, u01, v01, field) {
    const fx = clamp(u01, 0, 1) * (NLON - 1);
    const fy = clamp(v01, 0, 1) * (NLAT - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, NLON - 1), y1 = Math.min(y0 + 1, NLAT - 1);
    const tx = fx - x0, ty = fy - y0;
    let acc = 0, wsum = 0;
    const add = (x, y, w) => {
      if (w <= 0 || !cellValid(d, y, x)) return;
      acc += w * valueAt(day, d, y, x, field);
      wsum += w;
    };
    add(x0, y0, (1 - tx) * (1 - ty));
    add(x1, y0, tx * (1 - ty));
    add(x0, y1, (1 - tx) * ty);
    add(x1, y1, tx * ty);
    return wsum > 0 ? acc / wsum : null;
  }

  /* ------------------------- shared app state --------------------------- */
  const state = {
    day: 0,
    field: 'pred',
    scaleMode: 'auto',
    depth: 8,
    cmpDepth: 8,
    latIdx: 24,
    lonIdx: 30,
    ranges: [],
    globalRange: [0, 1],
    textures: [],
    coast: null
  };

  /* ------------------------- colour range handling ---------------------- */
  function fieldFor(field) { return field; }

  function computeRanges() {
    const f = state.field;
    state.ranges = [];
    let gLo = Infinity, gHi = -Infinity;
    for (let d = 0; d < NDEP; d++) {
      let lo = Infinity, hi = -Infinity;
      for (let t = 0; t < NDAY; t++) {
        for (let i = 0; i < NLAT; i++) {
          for (let j = 0; j < NLON; j++) {
            const v = valueAt(t, d, i, j, f);
            if (v === null) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
      }
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (f === 'err') lo = 0;
      if (hi - lo < 1e-6) hi = lo + 0.25;
      state.ranges.push([lo, hi]);
      if (lo < gLo) gLo = lo;
      if (hi > gHi) gHi = hi;
    }
    if (f === 'err') gLo = 0;
    state.globalRange = [gLo, gHi];
  }

  function rangeFor(d) {
    return state.scaleMode === 'global' ? state.globalRange : state.ranges[d];
  }

  function tempToU(v, d) {
    const r = rangeFor(d);
    return clamp((v - r[0]) / (r[1] - r[0]), 0, 1);
  }

  /* --------------------------- texture prebuild ------------------------- */
  const TEX = 128;

  function buildTextures() {
    computeRanges();
    state.textures = [];
    const day = state.day, f = state.field;
    for (let d = 0; d < NDEP; d++) {
      const cv = document.createElement('canvas');
      cv.width = TEX; cv.height = TEX;
      const c = cv.getContext('2d');
      const img = c.createImageData(TEX, TEX);
      const dat = img.data;
      const rng = rangeFor(d);
      const span = rng[1] - rng[0];
      for (let py = 0; py < TEX; py++) {
        const v01 = (py + 0.5) / TEX;
        for (let px = 0; px < TEX; px++) {
          const idx = (py * TEX + px) * 4;
          const u01 = (px + 0.5) / TEX;
          const v = sampleField(day, d, u01, v01, f);
          if (v === null) { dat[idx + 3] = 0; continue; }
          const rgb = lutRGB((v - rng[0]) / span);
          dat[idx] = rgb[0]; dat[idx + 1] = rgb[1]; dat[idx + 2] = rgb[2]; dat[idx + 3] = 255;
        }
      }
      c.putImageData(img, 0, 0);
      state.textures.push(cv);
    }
  }

  /* --------------------------- canvas plumbing -------------------------- */
  function fitCanvas(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 600;
    const aw = parseFloat(cv.getAttribute('width')) || 600;
    const ah = parseFloat(cv.getAttribute('height')) || 400;
    const h = w * (ah / aw);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h, ctx: c };
  }

  /* ----------------------------- coastlines ----------------------------- */
  const BBOX = { lon0: 78.0, lon1: 92.5, lat0: 8.0, lat1: 22.5 };
  function loadCoast() {
    if (!window.fetch) return;
    fetch('assets/land_boundaries.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j) { state.coast = j; window.__oeRedrawAll && window.__oeRedrawAll(); } })
      .catch(() => { /* offline: skip coastline overlay */ });
  }
  function drawCoast(ctx, x0, y0, w, h, lonA, lonB, latA, latB, tone) {
    if (!state.coast) return;
    const px = lon => x0 + ((lon - lonA) / (lonB - lonA)) * w;
    const py = lat => y0 + ((latB - lat) / (latB - latA)) * h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    ctx.lineJoin = 'round';
    for (let k = 0; k < state.coast.length; k++) {
      const g = state.coast[k].geometry;
      const rings = g.type === 'Polygon' ? g.coordinates : [];
      for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        ctx.beginPath();
        for (let n = 0; n < ring.length; n++) {
          const X = px(ring[n][0]), Y = py(ring[n][1]);
          if (n === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.closePath();
        ctx.fillStyle = tone.fill;
        ctx.fill();
        ctx.strokeStyle = tone.stroke;
        ctx.lineWidth = tone.lw || 1.2;
        ctx.stroke();
      }
    }
    ctx.restore();
  }


  /* ===================== ambient marine-snow background ================= */
  function initBackground() {
    const cv = $('#bgCanvas');
    if (!cv || prefersReduced) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    let W = 0, H = 0, ctx = cv.getContext('2d');
    let parts = [];

    function spawn(anywhere) {
      const r = Math.random();
      return {
        x: Math.random() * W,
        y: anywhere ? Math.random() * H : -20,
        r: 0.6 + Math.random() * 1.9,
        vy: 0.12 + Math.random() * 0.55,
        vx: (Math.random() - 0.5) * 0.16,
        a: 0.12 + Math.random() * 0.5,
        hue: r < 0.72 ? '#7dd3fc' : (r < 0.9 ? '#5eead4' : '#c4b5fd')
      };
    }
    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(clamp((W * H) / 26000, 40, 130));
      parts = [];
      for (let i = 0; i < n; i++) parts.push(spawn(true));
    }
    function frame() {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.y += p.vy; p.x += p.vx;
        if (p.y > H + 20 || p.x < -30 || p.x > W + 30) parts[i] = spawn(false);
        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.hue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }
    resize();
    window.addEventListener('resize', resize);
    frame();
  }

  /* ========================= header + navigation ======================== */
  function initNav() {
    const nav = $('.nav'), bar = $('#scrollBar'), burger = $('#navBurger'), links = $('#navLinks');
    const sections = $$('main section[id]');
    const anchors = $$('#navLinks a');

    function onScroll() {
      const y = window.scrollY || document.documentElement.scrollTop;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      if (bar) bar.style.width = ((y / max) * 100) + '%';
      if (nav) nav.classList.toggle('is-stuck', y > 12);
      const top = $('#toTop');
      if (top) top.classList.toggle('is-on', y > 700);

      let current = '';
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        if (s.offsetTop - 140 <= y) current = s.id;
      }
      anchors.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + current));
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if (burger && links) {
      burger.addEventListener('click', () => {
        const open = links.classList.toggle('is-open');
        burger.classList.toggle('is-open', open);
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      links.addEventListener('click', e => {
        if (e.target.tagName === 'A') {
          links.classList.remove('is-open');
          burger.classList.remove('is-open');
          burger.setAttribute('aria-expanded', 'false');
        }
      });
    }
    const toTop = $('#toTop');
    if (toTop) toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' }));
  }


  /* ====================== scroll reveal + counters ====================== */
  function initReveal() {
    const els = $$('.reveal');
    const kpi = $$('.kpi-bar span');
    if (!('IntersectionObserver' in window) || prefersReduced) {
      els.forEach(e => e.classList.add('is-in'));
      kpi.forEach(s => s.classList.add('go'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const el = en.target;
        const delay = parseInt(el.getAttribute('data-delay') || '0', 10);
        setTimeout(() => el.classList.add('is-in'), delay);
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(e => io.observe(e));

    const io2 = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('go'); io2.unobserve(en.target); } });
    }, { threshold: 0.35 });
    kpi.forEach(k => io2.observe(k));
  }

  function countUp(el) {
    const target = parseFloat(el.getAttribute('data-count'));
    const dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    const dur = 1500, t0 = performance.now();
    function step(t) {
      const k = clamp((t - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = (target * e).toFixed(dec);
      if (k < 1) requestAnimationFrame(step); else el.textContent = target.toFixed(dec);
    }
    requestAnimationFrame(step);
  }
  function initCounters() {
    const els = $$('.count');
    const setFinal = e => { e.textContent = parseFloat(e.getAttribute('data-count')).toFixed(parseInt(e.getAttribute('data-dec') || '0', 10)); };
    if (prefersReduced || !('IntersectionObserver' in window)) { els.forEach(setFinal); return; }
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { countUp(en.target); io.unobserve(en.target); } });
    }, { threshold: 0.5 });
    els.forEach(e => io.observe(e));
  }

  /* ========================= hero rotating words ======================== */
  function initRotator() {
    const track = $('#rotTrack');
    if (!track) return;
    const words = ['sea-surface temperature', 'salinity structure', 'sea-surface height', 'zonal surface flow', 'meridional surface flow'];
    let i = 0;
    const nodes = words.map(w => {
      const s = document.createElement('span');
      s.className = 'rot-word';
      s.textContent = w;
      track.appendChild(s);
      return s;
    });
    function show(n) {
      nodes.forEach((s, k) => {
        s.classList.toggle('is-live', k === n);
        s.classList.toggle('is-out', k === ((n - 1 + nodes.length) % nodes.length));
      });
    }
    show(0);
    if (prefersReduced) return;
    setInterval(() => { i = (i + 1) % nodes.length; show(i); }, 2400);
  }


  /* =====================================================================
     3D DEPTH STACK  —  orthographic renderer with affine texture mapping
     Each of the 15 depth levels is a thin, textured slab. Drag to orbit,
     scroll to zoom, hover to ray-cast, click to select.
     ===================================================================== */
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const PLANE_S = 1.0;      // plane half-size in world units
  const THICK = 0.020;      // slab thickness in world units

  const EXPL = {
    cv: null, ctx: null, W: 900, H: 600,
    yaw: -0.62, pitch: 0.74, zoom: 1, explode: 0.32,
    dragging: false, lastX: 0, lastY: 0, moved: 0,
    hover: -1, auto: true, sweep: false, sweepT: 0, raf: 0
  };

  function depthNorm(d) { return Math.log1p(DEPTHS[d]) / Math.log1p(DEPTHS[NDEP - 1]); }
  function layerY(d) { return depthNorm(d) * (0.55 + EXPL.explode * 1.5); }
  function fmtDepth(d) { return DEPTHS[d].toFixed(1); }
  function sceneScale() { return Math.min(EXPL.W, EXPL.H * 1.35) * 0.30 * EXPL.zoom; }
  function sceneCenter() { return { x: EXPL.W / 2, y: EXPL.H * 0.545 }; }

  function rotatePoint(x, y, z) {
    const cy = Math.cos(EXPL.yaw), sy = Math.sin(EXPL.yaw);
    const X = x * cy + z * sy;
    const Z1 = -x * sy + z * cy;
    const cp = Math.cos(EXPL.pitch), sp = Math.sin(EXPL.pitch);
    return { x: X, y: y * cp - Z1 * sp, z: y * sp + Z1 * cp, sp: sp, cp: cp };
  }
  function project(x, y, z, scale, cx, cyv) {
    const r = rotatePoint(x, y, z);
    return { x: cx + r.x * scale, y: cyv + r.y * scale, z: r.z };
  }

  function buildLayers() {
    const scale = sceneScale(), c = sceneCenter();
    const sel = state.depth;
    const out = [];
    for (let d = 0; d < NDEP; d++) {
      let y = layerY(d);
      if (d === sel) y -= 0.045 * (1 + EXPL.explode * 0.7);
      const A = project(-PLANE_S, y, PLANE_S, scale, c.x, c.y);
      const B = project(PLANE_S, y, PLANE_S, scale, c.x, c.y);
      const C = project(PLANE_S, y, -PLANE_S, scale, c.x, c.y);
      const E = project(-PLANE_S, y, -PLANE_S, scale, c.x, c.y);
      out.push({ d: d, quad: [A, B, C, E], z: (A.z + B.z + C.z + E.z) / 4 });
    }
    return out;
  }

  function drawQuadPath(ctx, P, offY) {
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y + (offY || 0));
    for (let k = 1; k < 4; k++) ctx.lineTo(P[k].x, P[k].y + (offY || 0));
    ctx.closePath();
  }


  function renderStack() {
    const ctx = EXPL.ctx;
    if (!ctx) return;
    const W = EXPL.W, H = EXPL.H;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    /* soft volumetric backdrop */
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.42, 20, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
    bg.addColorStop(0, 'rgba(20,52,96,0.55)');
    bg.addColorStop(0.45, 'rgba(8,20,42,0.28)');
    bg.addColorStop(1, 'rgba(3,6,13,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const layers = buildLayers();
    const order = layers.slice().sort(function (a, b) { return a.z - b.z; });   // far to near
    const rp = rotatePoint(0, 1, 0);
    const dy = THICK * rp.cp * sceneScale();
    const sel = state.depth, hov = EXPL.hover;

    /* depth ruler threaded through the near corners */
    ctx.save();
    ctx.strokeStyle = 'rgba(125,211,252,0.32)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    for (let k = 0; k < layers.length; k++) {
      const P = layers[k].quad;
      let best = P[0];
      for (let q = 1; q < 4; q++) if (P[q].y > best.y) best = P[q];
      if (k === 0) ctx.moveTo(best.x, best.y); else ctx.lineTo(best.x, best.y);
    }
    ctx.stroke();
    ctx.restore();

    /* slabs painted far to near */
    for (let k = 0; k < order.length; k++) {
      const L = order[k], P = L.quad;
      const isSel = L.d === sel;
      const isHov = (L.d === hov) && !isSel;
      const alpha = isSel ? 1 : (isHov ? 0.94 : 0.68);

      /* side wall: outer ring formed by the top face and its thickness offset */
      ctx.beginPath();
      ctx.moveTo(P[0].x, P[0].y);
      for (let q = 1; q < 4; q++) ctx.lineTo(P[q].x, P[q].y);
      ctx.closePath();
      for (let q = 3; q >= 0; q--) ctx.lineTo(P[q].x, P[q].y + dy);
      ctx.closePath();
      ctx.fillStyle = isSel ? 'rgba(18,74,96,0.96)' : 'rgba(9,24,44,0.92)';
      ctx.fill();

      /* textured top face via affine mapping of the prebuilt texture */
      const U = { x: P[1].x - P[0].x, y: P[1].y - P[0].y };
      const V = { x: P[3].x - P[0].x, y: P[3].y - P[0].y };
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.setTransform(DPR * U.x, DPR * U.y, DPR * V.x, DPR * V.y, DPR * P[0].x, DPR * P[0].y);
      if (state.textures && state.textures[L.d]) {
        ctx.drawImage(state.textures[L.d], 0, 0, 1, 1);
      }
      ctx.restore();

      /* glass edge */
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      drawQuadPath(ctx, P, 0);
      if (isSel) {
        ctx.shadowColor = 'rgba(34,211,238,0.95)';
        ctx.shadowBlur = 26;
        ctx.strokeStyle = 'rgba(234,252,255,0.98)';
        ctx.lineWidth = 2.1;
      } else if (isHov) {
        ctx.strokeStyle = 'rgba(125,211,252,0.85)';
        ctx.lineWidth = 1.6;
      } else {
        ctx.strokeStyle = 'rgba(125,211,252,0.24)';
        ctx.lineWidth = 1;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    /* corner posts binding the volume together */
    ctx.strokeStyle = 'rgba(125,211,252,0.15)';
    ctx.lineWidth = 1;
    for (let c = 0; c < 4; c++) {
      ctx.beginPath();
      ctx.moveTo(layers[0].quad[c].x, layers[0].quad[c].y);
      ctx.lineTo(layers[NDEP - 1].quad[c].x, layers[NDEP - 1].quad[c].y);
      ctx.stroke();
    }

    /* callouts for hovered / selected slab */
    const labelD = (hov >= 0 && hov !== sel) ? hov : sel;
    drawCallout(ctx, layers[labelD], labelD === sel);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function drawCallout(ctx, L, primary) {
    const P = L.quad;
    let best = 0;
    for (let q = 1; q < 4; q++) if (P[q].x < P[best].x) best = q;
    const px = P[best].x, py = P[best].y;
    ctx.strokeStyle = primary ? 'rgba(34,211,238,0.9)' : 'rgba(125,211,252,0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - 44, py);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 3.4, 0, 6.2832);
    ctx.fillStyle = primary ? '#eafcff' : 'rgba(125,211,252,0.9)';
    ctx.fill();
    ctx.font = '700 12px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = primary ? '#eafcff' : 'rgba(168,190,221,0.9)';
    ctx.fillText(fmtDepth(L.d) + ' m', px - 50, py);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }


  /* --------------------------- picking / raycast ------------------------ */
  function pickLayer(mx, my) {
    const layers = buildLayers();
    layers.sort(function (a, b) { return b.z - a.z; });   // nearest first
    for (let k = 0; k < layers.length; k++) {
      const L = layers[k], P = L.quad;
      const Ux = P[1].x - P[0].x, Uy = P[1].y - P[0].y;
      const Vx = P[3].x - P[0].x, Vy = P[3].y - P[0].y;
      const det = Ux * Vy - Uy * Vx;
      if (Math.abs(det) < 1e-6) continue;
      const dx = mx - P[0].x, dyv = my - P[0].y;
      const u = (Vy * dx - Vx * dyv) / det;
      const v = (-Uy * dx + Ux * dyv) / det;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        return { d: L.d, u: u, v: v, cx: mx, cy: my };
      }
    }
    return null;
  }

  function uvToCell(hit) {
    const lonIdx = clamp(Math.round(hit.u * (NLON - 1)), 0, NLON - 1);
    const latIdx = clamp(Math.round((1 - hit.v) * (NLAT - 1)), 0, NLAT - 1);
    return { lonIdx: lonIdx, latIdx: latIdx };
  }

  /* ----------------------------- loop / render -------------------------- */
  let lastT = 0;
  function loop(t) {
    const dt = Math.min(48, t - lastT || 16);
    lastT = t;
    let dirty = false;

    if (EXPL.auto && !EXPL.dragging) {
      EXPL.yaw += dt * 0.00016;
      dirty = true;
    }
    if (EXPL.sweep) {
      EXPL.sweepT += dt / 5200;
      if (EXPL.sweepT >= 1) { EXPL.sweepT = 0; EXPL.sweep = false; }
      setDepth(Math.round(EXPL.sweepT * (NDEP - 1)), false);
      dirty = true;
    }
    if (dirty) renderStack();
    EXPL.raf = requestAnimationFrame(loop);
  }

  /* --------------------------- explorer wiring -------------------------- */
  function setDepth(d, rerender) {
    d = clamp(d, 0, NDEP - 1);
    if (d === state.depth && !rerender) { syncOfDepth(); return; }
    state.depth = d;
    syncOfDepth();
    if (rerender !== false) renderStack();
  }

  function syncOfDepth() {
    const d = state.depth;
    const el = $('#roDepth'); if (el) el.textContent = fmtDepth(d);
    const rail = $$('#depthRail .rail-item');
    rail.forEach(function (b) { b.classList.toggle('is-on', parseInt(b.getAttribute('data-d'), 10) === d); });
    const m = METRICS[Math.min(d, METRICS.length - 1)];
    const rng = rangeFor(d);
    let sum = 0, n = 0;
    for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) {
      const v = valueAt(state.day, d, i, j, state.field);
      if (v !== null) { sum += v; n++; }
    }
    const mean = n ? sum / n : NaN;
    const tEl = $('#roTemp'); if (tEl) tEl.textContent = isNaN(mean) ? '\u2014' : mean.toFixed(2);
    const rEl = $('#roRange');
    if (rEl) rEl.textContent = rng[0].toFixed(2) + ' \u2013 ' + rng[1].toFixed(2) + '\u00B0C \u00B7 day ' + DAYS[state.day];
    setText('#roRMSE', m.rmse.toFixed(2) + ' \u00B0C');
    setText('#roBias', (m.bias >= 0 ? '+' : '') + m.bias.toFixed(2) + ' \u00B0C');
    setText('#roACC', m.acc.toFixed(2));
    setText('#roBase', m.base.toFixed(2) + ' \u00B0C');
    setText('#hudDepth', fmtDepth(d));
    updateLegend(d);
    drawSlice();
    drawProfile();
  }

  function setText(sel, txt) { const e = $(sel); if (e) e.textContent = txt; }

  function updateLegend(d) {
    const rng = rangeFor(d);
    const bar = $('#legendBar');
    if (bar) {
      bar.style.background = 'linear-gradient(90deg,' + lutAt(0) + ',' + lutAt(0.25) + ',' +
        lutAt(0.5) + ',' + lutAt(0.75) + ',' + lutAt(1) + ')';
    }
    setText('#legendRange', rng[0].toFixed(1) + '\u00B0 \u2013 ' + rng[1].toFixed(1) + '\u00B0C');
    const ticks = $('#legendTicks');
    if (ticks) {
      ticks.innerHTML = '';
      for (let k = 0; k <= 4; k++) {
        const s = document.createElement('span');
        s.textContent = lerp(rng[0], rng[1], k / 4).toFixed(1);
        ticks.appendChild(s);
      }
    }
    const title = $('#legendTitle');
    if (title) title.textContent = state.field === 'err' ? 'Absolute error' : 'Temperature';
  }


  /* ------------------------------ chip bars ----------------------------- */
  function buildDayChips() {
    const host = $('#dayChips');
    if (!host) return;
    DAYS.forEach(function (label, i) {
      const b = document.createElement('button');
      b.className = 'chip' + (i === state.day ? ' is-on' : '');
      b.textContent = label.slice(5);
      b.setAttribute('data-day', i);
      b.addEventListener('click', function () {
        state.day = i;
        $$('#dayChips .chip').forEach(function (c) { c.classList.remove('is-on'); });
        b.classList.add('is-on');
        refreshDataViews();
      });
      host.appendChild(b);
    });
  }

  function buildDepthRail() {
    const host = $('#depthRail');
    if (!host) return;
    const maxRMSE = Math.max.apply(null, METRICS.map(function (m) { return m.rmse; }));
    DEPTHS.forEach(function (dep, d) {
      const b = document.createElement('button');
      b.className = 'rail-item' + (d === state.depth ? ' is-on' : '');
      b.setAttribute('data-d', d);
      b.innerHTML = '<span class="rail-i">' + (d + 1) + '</span>' +
        '<span class="rail-t">' + dep.toFixed(1) + ' m</span>' +
        '<span class="rail-bar"><i style="width:' + ((METRICS[d].rmse / maxRMSE) * 100).toFixed(1) + '%"></i></span>';
      b.addEventListener('click', function () { setDepth(d); });
      b.addEventListener('mouseenter', function () { EXPL.hover = d; renderStack(); });
      b.addEventListener('mouseleave', function () { EXPL.hover = -1; renderStack(); });
      host.appendChild(b);
    });
  }

  function buildLatSeg() {
    const host = $('#latSeg');
    if (!host) return;
    [['South', 6], ['Mid', 24], ['North', 34]].forEach(function (pair, i) {
      const b = document.createElement('button');
      b.textContent = pair[0];
      if (i === 1) b.classList.add('is-on');
      b.addEventListener('click', function () {
        state.latIdx = pair[1];
        $$('#latSeg button').forEach(function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
        drawSection();
      });
      host.appendChild(b);
    });
  }

  function refreshDataViews() {
    buildTextures();
    renderStack();
    syncOfDepth();
    drawComparison();
  }


  /* ----------------------------- init 3D -------------------------------- */
  function initExplorer() {
    const stage = $('#stage');
    const cv = $('#stackCanvas');
    const tip = $('#stageTip');
    const hint = $('#stageHint');
    if (!stage || !cv || !D || !D.pred) return;

    EXPL.cv = cv;
    EXPL.ctx = cv.getContext('2d');

    function resize() {
      const w = cv.clientWidth || stage.clientWidth || 900;
      const h = cv.clientHeight || 600;
      EXPL.W = w; EXPL.H = h;
      cv.width = Math.round(w * DPR);
      cv.height = Math.round(h * DPR);
      EXPL.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      renderStack();
    }
    function localPos(e) {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    let downAt = null;
    cv.addEventListener('pointerdown', function (e) {
      EXPL.dragging = true; EXPL.moved = 0;
      const p = localPos(e);
      EXPL.lastX = p.x; EXPL.lastY = p.y;
      downAt = p;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (hint) hint.classList.add('is-hidden');
    });

    cv.addEventListener('pointermove', function (e) {
      const p = localPos(e);
      if (EXPL.dragging) {
        const dx = p.x - EXPL.lastX, dyv = p.y - EXPL.lastY;
        EXPL.moved += Math.abs(dx) + Math.abs(dyv);
        EXPL.yaw += dx * 0.0075;
        EXPL.pitch = clamp(EXPL.pitch + dyv * 0.0055, 0.22, 1.42);
        EXPL.lastX = p.x; EXPL.lastY = p.y;
        renderStack();
        return;
      }
      const hit = pickLayer(p.x, p.y);
      const prev = EXPL.hover;
      EXPL.hover = hit ? hit.d : -1;
      if (hit) {
        const cell = uvToCell(hit);
        state.latIdx = cell.latIdx; state.lonIdx = cell.lonIdx;
        const v = valueAt(state.day, hit.d, cell.latIdx, cell.lonIdx, state.field);
        if (tip) {
          tip.hidden = false;
          tip.style.left = p.x + 'px';
          tip.style.top = p.y + 'px';
          tip.innerHTML = '<b>' + D.lat[cell.latIdx].toFixed(2) + '\u00B0N, ' +
            D.lon[cell.lonIdx].toFixed(2) + '\u00B0E</b><br>' +
            'depth ' + DEPTHS[hit.d].toFixed(1) + ' m \u00B7 ' +
            (v === null ? 'land' : v.toFixed(2) + ' \u00B0C');
        }
        setText('#hudTemp', v === null ? '\u2014' : v.toFixed(2));
        setText('#miniCoord', D.lat[cell.latIdx].toFixed(1) + '\u00B0N ' + D.lon[cell.lonIdx].toFixed(1) + '\u00B0E');
        drawProfile();
      } else {
        if (tip) tip.hidden = true;
        setText('#hudTemp', '\u2014');
      }
      if (prev !== EXPL.hover) renderStack();
      else drawSlice();
    });

    function endDrag(e) {
      if (!EXPL.dragging) return;
      EXPL.dragging = false;
      if (EXPL.moved < 6 && downAt) {
        const hit = pickLayer(downAt.x, downAt.y);
        if (hit) setDepth(hit.d);
      }
      downAt = null;
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('pointerleave', function () {
      EXPL.hover = -1;
      if (tip) tip.hidden = true;
      renderStack();
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      EXPL.zoom = clamp(EXPL.zoom * (e.deltaY > 0 ? 0.93 : 1.075), 0.5, 2.8);
      renderStack();
      if (hint) hint.classList.add('is-hidden');
    }, { passive: false });
    cv.addEventListener('dblclick', function () {
      EXPL.yaw = -0.62; EXPL.pitch = 0.74; EXPL.zoom = 1; EXPL.explode = 0.32;
      const sl = $('#explode'); if (sl) sl.value = 32;
      setText('#explodeOut', '32%');
      renderStack();
    });

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  }


  /* -------------------------- explorer controls ------------------------- */
  function initExplorerControls() {
    const sl = $('#explode');
    if (sl) {
      sl.addEventListener('input', function () {
        EXPL.explode = parseInt(sl.value, 10) / 100;
        setText('#explodeOut', sl.value + '%');
        renderStack();
      });
    }

    $$('#fieldToggle .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#fieldToggle .chip').forEach(function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
        state.field = b.getAttribute('data-field');
        const badge = $('#roField');
        if (badge) {
          badge.textContent = state.field === 'pred' ? 'Prediction' : (state.field === 'truth' ? 'GLORYS truth' : 'Absolute error');
          badge.setAttribute('data-f', state.field);
        }
        refreshDataViews();
      });
    });

    const auto = $('#scaleAuto'), glob = $('#scaleGlobal');
    function setScale(mode) {
      state.scaleMode = mode;
      if (auto) auto.classList.toggle('is-on', mode === 'auto');
      if (glob) glob.classList.toggle('is-on', mode === 'global');
      refreshDataViews();
    }
    if (auto) auto.addEventListener('click', function () { setScale('auto'); });
    if (glob) glob.addEventListener('click', function () { setScale('global'); });

    const btnAuto = $('#btnAuto'), btnReset = $('#btnReset'), btnPlay = $('#btnPlay');
    if (btnAuto) {
      btnAuto.classList.add('is-on');
      btnAuto.addEventListener('click', function () {
        EXPL.auto = !EXPL.auto;
        btnAuto.classList.toggle('is-on', EXPL.auto);
      });
    }
    if (btnReset) {
      btnReset.addEventListener('click', function () {
        EXPL.yaw = -0.62; EXPL.pitch = 0.74; EXPL.zoom = 1;
        renderStack();
      });
    }
    if (btnPlay) {
      btnPlay.addEventListener('click', function () {
        EXPL.sweep = !EXPL.sweep;
        btnPlay.classList.toggle('is-on', EXPL.sweep);
        if (EXPL.sweep) EXPL.sweepT = 0;
      });
    }
  }

  /* ==================== plan-view slice (2D heat map) =================== */
  function drawSlice() {
    const cv = $('#sliceCanvas');
    if (!cv || !D) return;
    const info = fitCanvas(cv);
    const ctx = info.ctx, W = info.w, H = info.h;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, W, H);

    const d = state.depth;
    const pad = 26, top = 12;
    const pw = W - pad * 2, ph = H - top - pad;
    const tex = state.textures[d];
    if (!tex) return;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tex, pad, top, pw, ph);

    drawCoast(ctx, pad, top, pw, ph, BBOX.lon0, BBOX.lon1, BBOX.lat0, BBOX.lat1,
      { fill: 'rgba(8,16,30,0.85)', stroke: 'rgba(160,190,225,0.75)', lw: 1 });

    /* graticule + ticks */
    ctx.strokeStyle = 'rgba(125,211,252,0.18)';
    ctx.lineWidth = 1;
    for (let k = 1; k < 5; k++) {
      const gx = pad + (pw * k) / 5, gy = top + (ph * k) / 5;
      ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, top + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(pad + pw, gy); ctx.stroke();
    }
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(168,190,221,0.85)';
    ctx.textAlign = 'center';
    for (let k = 0; k <= 4; k++) {
      const lon = lerp(D.lon[0], D.lon[NLON - 1], k / 4);
      ctx.fillText(lon.toFixed(1) + '\u00B0E', pad + (pw * k) / 4, top + ph + 16);
    }
    ctx.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const lat = lerp(D.lat[NLAT - 1], D.lat[0], k / 4);
      ctx.fillText(lat.toFixed(1) + '\u00B0N', pad - 5, top + (ph * k) / 4 + 3);
    }
    ctx.textAlign = 'left';

    /* frame */
    ctx.strokeStyle = 'rgba(125,211,252,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad + 0.5, top + 0.5, pw - 1, ph - 1);

    /* cursor marker */
    const cx = pad + ((D.lon[state.lonIdx] - D.lon[0]) / (D.lon[NLON - 1] - D.lon[0])) * pw;
    const cy = top + ((D.lat[NLAT - 1] - D.lat[state.latIdx]) / (D.lat[NLAT - 1] - D.lat[0])) * ph;
    ctx.strokeStyle = '#eafcff';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 6.2832); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, 6.2832); ctx.fillStyle = '#eafcff'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, top); ctx.lineTo(cx, cy - 8);
    ctx.moveTo(cx, cy + 8); ctx.lineTo(cx, top + ph);
    ctx.moveTo(pad, cy); ctx.lineTo(cx - 8, cy);
    ctx.moveTo(cx + 8, cy); ctx.lineTo(pad + pw, cy);
    ctx.strokeStyle = 'rgba(234,252,255,0.45)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }


  /* ======================= vertical profile chart ======================= */
  function drawProfile() {
    const cv = $('#profileCanvas');
    if (!cv || !D) return;
    const info = fitCanvas(cv);
    const ctx = info.ctx, W = info.w, H = info.h;
    ctx.clearRect(0, 0, W, H);

    const L = 54, R = 18, T = 22, B = 40;
    const pw = W - L - R, ph = H - T - B;
    const i = state.latIdx, j = state.lonIdx;

    const tLo = Math.min(rangeFor(0)[0], rangeFor(NDEP - 1)[0]);
    const tHi = Math.max(rangeFor(0)[1], rangeFor(NDEP - 1)[1]);

    ctx.strokeStyle = 'rgba(125,211,252,0.16)';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    for (let k = 0; k < NDEP; k++) {
      const y = T + depthNorm(k) * ph;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(112,137,168,0.95)';
      ctx.fillText(DEPTHS[k].toFixed(0), L - 7, y + 3);
    }
    ctx.textAlign = 'center';
    for (let k = 0; k <= 5; k++) {
      const x = L + (pw * k) / 5;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      ctx.fillStyle = 'rgba(112,137,168,0.95)';
      ctx.fillText(lerp(tLo, tHi, k / 5).toFixed(1), x, H - 18);
    }
    ctx.fillStyle = 'rgba(168,190,221,0.9)';
    ctx.fillText('Temperature (\u00B0C)', L + pw / 2, H - 4);
    ctx.save();
    ctx.translate(14, T + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Depth (m)', 0, 0);
    ctx.restore();

    const X = v => L + ((v - tLo) / (tHi - tLo)) * pw;
    const Y = k => T + depthNorm(k) * ph;

    function series(field, color, dashed, fill) {
      const pts = [];
      for (let k = 0; k < NDEP; k++) {
        const v = valueAt(state.day, k, i, j, field);
        pts.push(v === null ? null : { x: X(v), y: Y(k) });
      }
      if (fill) {
        ctx.beginPath();
        let started = false;
        for (let k = 0; k < pts.length; k++) {
          if (!pts[k]) continue;
          if (!started) { ctx.moveTo(pts[k].x, pts[k].y); started = true; } else ctx.lineTo(pts[k].x, pts[k].y);
        }
        if (started) {
          ctx.lineTo(pts[pts.length - 1].x, Y(NDEP - 1));
          ctx.lineTo(pts[0].x, Y(0));
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
        }
      }
      ctx.beginPath();
      let started = false;
      for (let k = 0; k < pts.length; k++) {
        if (!pts[k]) continue;
        if (!started) { ctx.moveTo(pts[k].x, pts[k].y); started = true; } else ctx.lineTo(pts[k].x, pts[k].y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.setLineDash(dashed ? [6, 5] : []);
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.setLineDash([]);
      for (let k = 0; k < pts.length; k++) {
        if (!pts[k]) continue;
        const isSel = k === state.depth;
        ctx.beginPath();
        ctx.arc(pts[k].x, pts[k].y, isSel ? 5 : 3, 0, 6.2832);
        ctx.fillStyle = isSel ? '#eafcff' : color;
        ctx.fill();
        if (isSel) {
          ctx.strokeStyle = 'rgba(34,211,238,0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    series('truth', 'rgba(251,191,36,0.95)', true, 'rgba(251,191,36,0.07)');
    series('pred', '#22d3ee', false, 'rgba(34,211,238,0.10)');

    const ys = Y(state.depth);
    ctx.strokeStyle = 'rgba(234,252,255,0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(L, ys); ctx.lineTo(L + pw, ys); ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign = 'left';
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(234,252,255,0.95)';
    ctx.fillText(D.lat[i].toFixed(2) + '\u00B0N  ' + D.lon[j].toFixed(2) + '\u00B0E  \u00B7  ' + DAYS[state.day], L, 14);
    ctx.textAlign = 'right';
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#22d3ee';
    ctx.fillText('\u2014 OceanEmbed', L + pw, 14);
    ctx.fillStyle = 'rgba(251,191,36,0.95)';
    ctx.fillText('\u2014 \u2014 GLORYS truth', L + pw, 28);
    ctx.textAlign = 'left';
  }


  /* ================== depth x longitude cross-section ================== */
  function drawSection() {
    const cv = $('#sectionCanvas');
    if (!cv || !D) return;
    const info = fitCanvas(cv);
    const ctx = info.ctx, W = info.w, H = info.h;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, W, H);

    const L = 54, R = 18, T = 22, B = 40;
    const pw = W - L - R, ph = H - T - B;
    const i = state.latIdx, NX = 120;

    for (let k = 0; k < NDEP; k++) {
      const y0 = T + (k === 0 ? 0 : depthNorm(k - 1) * ph);
      const y1 = T + depthNorm(k) * ph;
      const band = Math.max(1.6, y1 - y0);
      for (let n = 0; n < NX; n++) {
        const u = (n + 0.5) / NX;
        const v = (k + 0.5) / NDEP;
        const val = sampleField(state.day, k, u, v, state.field);
        if (val === null) continue;
        ctx.fillStyle = lutAt(tempToU(val, k));
        ctx.fillRect(L + (pw * n) / NX, y0 - 0.5, pw / NX + 1, band + 1);
      }
    }

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(168,190,221,0.9)';
    ctx.textAlign = 'right';
    for (let k = 0; k < NDEP; k++) {
      const y = T + (k === 0 ? 0 : depthNorm(k - 1) * ph);
      ctx.fillText(DEPTHS[k].toFixed(0), L - 7, y + 10);
    }
    ctx.textAlign = 'center';
    for (let k = 0; k <= 4; k++) {
      const lon = lerp(D.lon[0], D.lon[NLON - 1], k / 4);
      ctx.fillText(lon.toFixed(1) + '\u00B0E', L + (pw * k) / 4, H - 18);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(234,252,255,0.95)';
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillText('Latitude ' + D.lat[i].toFixed(2) + '\u00B0N  \u00B7  ' + DAYS[state.day] +
      '  \u00B7  ' + (state.field === 'err' ? '|error|' : state.field), L, 14);

    ctx.strokeStyle = 'rgba(125,211,252,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
  }

  /* ===================== results chart + metrics table ================= */
  function buildMetricsTable() {
    const tb = $('#metricsBody');
    if (!tb) return;
    tb.innerHTML = '';
    METRICS.forEach(function (m) {
      const skill = (1 - m.rmse / m.base) * 100;
      const cls = m.rmse <= 0.45 ? 'cell-good' : (m.rmse <= 0.85 ? 'cell-mid' : 'cell-bad');
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + m.d.toFixed(1) + '</td>' +
        '<td class="' + cls + '">' + m.rmse.toFixed(2) + '</td>' +
        '<td>' + (m.bias >= 0 ? '+' : '') + m.bias.toFixed(2) + '</td>' +
        '<td>' + m.base.toFixed(2) + '</td>' +
        '<td>' + m.acc.toFixed(2) + '</td>' +
        '<td><span class="skillbar"><i style="width:' + clamp(skill, 0, 100).toFixed(1) +
        '%"></i><span>' + skill.toFixed(0) + '% better</span></span></td>';
      tb.appendChild(tr);
    });
  }


  function drawBarChart() {
    const cv = $('#barCanvas');
    if (!cv) return;
    const info = fitCanvas(cv);
    const ctx = info.ctx, W = info.w, H = info.h;
    ctx.clearRect(0, 0, W, H);

    const L = 62, R = 22, T = 30, B = 68;
    const pw = W - L - R, ph = H - T - B;
    const maxV = 2.5;

    ctx.strokeStyle = 'rgba(125,211,252,0.14)';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    for (let k = 0; k <= 5; k++) {
      const y = T + ph - (ph * k) / 5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillStyle = 'rgba(112,137,168,0.95)';
      ctx.textAlign = 'right';
      ctx.fillText((maxV * k / 5).toFixed(1), L - 8, y + 3);
    }
    ctx.save();
    ctx.translate(16, T + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(168,190,221,0.9)';
    ctx.fillText('RMSE (\u00B0C)', 0, 0);
    ctx.restore();

    const slot = pw / NDEP;
    const bw = Math.min(slot * 0.52, 44);

    for (let k = 0; k < NDEP; k++) {
      const cx = L + slot * (k + 0.5);
      const mv = METRICS[k].rmse, bv = METRICS[k].base;
      const mh = (mv / maxV) * ph, bh = (bv / maxV) * ph;

      ctx.fillStyle = 'rgba(251,191,36,0.10)';
      ctx.fillRect(cx - bw / 2 - 3, T + ph - bh, bw + 6, bh);
      ctx.strokeStyle = 'rgba(251,191,36,0.85)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(cx - bw / 2 - 2.5, T + ph - bh + 0.5, bw + 5, Math.max(1, bh - 1));
      ctx.setLineDash([]);

      const g = ctx.createLinearGradient(0, T + ph - mh, 0, T + ph);
      g.addColorStop(0, '#7dd3fc');
      g.addColorStop(0.55, '#22d3ee');
      g.addColorStop(1, '#0e7490');
      ctx.fillStyle = g;
      const x0 = cx - bw / 2, y0 = T + ph - mh, r = Math.min(6, bw / 2, mh);
      ctx.beginPath();
      ctx.moveTo(x0, T + ph);
      ctx.lineTo(x0, y0 + r);
      ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
      ctx.lineTo(x0 + bw - r, y0);
      ctx.quadraticCurveTo(x0 + bw, y0, x0 + bw, y0 + r);
      ctx.lineTo(x0 + bw, T + ph);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(234,252,255,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = '600 10.5px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(234,252,255,0.95)';
      ctx.fillText(mv.toFixed(2), cx, y0 - 7);

      ctx.save();
      ctx.translate(cx, T + ph + 12);
      ctx.rotate(-Math.PI / 3.2);
      ctx.textAlign = 'right';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(112,137,168,0.95)';
      ctx.fillText(METRICS[k].d.toFixed(1) + ' m', 0, 0);
      ctx.restore();
    }

    const mean = METRICS.reduce(function (a, m) { return a + m.rmse; }, 0) / METRICS.length;
    const my = T + ph - (mean / maxV) * ph;
    ctx.strokeStyle = 'rgba(45,212,191,0.9)';
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(L, my); ctx.lineTo(L + pw, my); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(45,212,191,0.95)';
    ctx.fillText('mean ' + mean.toFixed(2) + ' \u00B0C', L + 6, my - 6);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(112,137,168,0.95)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText('bars = OceanEmbed  \u00B7  gold dashed = Jan\u2013Apr climatology baseline', L + pw, T - 10);
    ctx.textAlign = 'left';
  }

  function initBarHover() {
    const cv = $('#barCanvas'), tip = $('#barTip');
    if (!cv || !tip) return;
    const L = 62, R = 22;
    cv.addEventListener('mousemove', function (e) {
      const r = cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * cv.clientWidth;
      const pw = cv.clientWidth - L - R;
      const slot = pw / NDEP;
      const k = Math.floor((x - L) / slot);
      if (k < 0 || k >= NDEP) { tip.hidden = true; return; }
      const m = METRICS[k];
      tip.hidden = false;
      tip.style.left = (((L + slot * (k + 0.5)) / cv.clientWidth) * 100) + '%';
      tip.style.top = '26px';
      tip.innerHTML = '<b>' + m.d.toFixed(1) + ' m</b><br>RMSE ' + m.rmse.toFixed(2) +
        ' \u00B0C<br>baseline ' + m.base.toFixed(2) + ' \u00B0C<br>ACC ' + m.acc.toFixed(2);
    });
    cv.addEventListener('mouseleave', function () { tip.hidden = true; });
  }


  /* =========================== compare section ========================== */
  function drawHeatMap(ctx, W, H, day, d, field, rng) {
    const L = 56, R = 20, T = 26, B = 42;
    const pw = W - L - R, ph = H - T - B;

    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, W, H);

    const cw = pw / NLON, ch = ph / NLAT;
    for (let i = 0; i < NLAT; i++) {
      for (let j = 0; j < NLON; j++) {
        const v = valueAt(day, d, i, j, field);
        const x = L + j * cw;
        const y = T + (NLAT - 1 - i) * ch;
        if (v === null) {
          ctx.fillStyle = 'rgba(16,24,40,0.92)';
          ctx.fillRect(x, y, cw + 1, ch + 1);
          continue;
        }
        ctx.fillStyle = lutAt((v - rng[0]) / (rng[1] - rng[0]));
        ctx.fillRect(x, y, cw + 1, ch + 1);
      }
    }

    drawCoast(ctx, L, T, pw, ph, BBOX.lon0, BBOX.lon1, BBOX.lat0, BBOX.lat1,
      { fill: 'rgba(6,12,24,0.25)', stroke: 'rgba(255,255,255,0.7)', lw: 1.1 });

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    for (let k = 1; k < 5; k++) {
      const gx = L + (pw * k) / 5, gy = T + (ph * k) / 5;
      ctx.beginPath(); ctx.moveTo(gx, T); ctx.lineTo(gx, T + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(L + pw, gy); ctx.stroke();
    }

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(234,252,255,0.85)';
    ctx.textAlign = 'center';
    for (let k = 0; k <= 4; k++) {
      const lon = lerp(D.lon[0], D.lon[NLON - 1], k / 4);
      ctx.fillText(lon.toFixed(1) + '\u00B0E', L + (pw * k) / 4, T + ph + 16);
    }
    ctx.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const lat = lerp(D.lat[NLAT - 1], D.lat[0], k / 4);
      ctx.fillText(lat.toFixed(1) + '\u00B0N', L - 6, T + (ph * k) / 4 + 3);
    }
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(125,211,252,0.4)';
    ctx.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
  }

  function drawComparison() {
    const cp = $('#cmpPredCanvas'), ct = $('#cmpTruthCanvas');
    if (!cp || !ct || !D) return;
    const day = state.day, d = state.cmpDepth;

    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < NLAT; i++) {
      for (let j = 0; j < NLON; j++) {
        const v = valueAt(day, d, i, j, 'truth');
        if (v === null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 0.2) hi = lo + 0.2;
    const rng = [lo, hi];

    const a = fitCanvas(cp), b = fitCanvas(ct);
    drawHeatMap(a.ctx, a.w, a.h, day, d, 'pred', rng);
    drawHeatMap(b.ctx, b.w, b.h, day, d, 'truth', rng);

    const bar = $('#cmpLegendBar');
    if (bar) {
      bar.style.background = 'linear-gradient(90deg,' + lutAt(0) + ',' + lutAt(0.25) + ',' +
        lutAt(0.5) + ',' + lutAt(0.75) + ',' + lutAt(1) + ')';
    }
    const ticks = $('#cmpLegendTicks');
    if (ticks) {
      ticks.innerHTML = '';
      for (let k = 0; k <= 4; k++) {
        const s = document.createElement('span');
        s.textContent = lerp(rng[0], rng[1], k / 4).toFixed(1);
        ticks.appendChild(s);
      }
    }
    const m = METRICS[Math.min(d, METRICS.length - 1)];
    const stats = $('#cmpStats');
    if (stats) {
      stats.innerHTML =
        '<span>depth <b>' + m.d.toFixed(1) + ' m</b></span>' +
        '<span>RMSE <b>' + m.rmse.toFixed(2) + ' \u00B0C</b></span>' +
        '<span>bias <b>' + (m.bias >= 0 ? '+' : '') + m.bias.toFixed(2) + ' \u00B0C</b></span>' +
        '<span>anomaly corr. <b>' + m.acc.toFixed(2) + '</b></span>';
    }
  }


  function initCompare() {
    if (!D) return;
    const selDay = $('#cmpDay');
    if (selDay) {
      DAYS.forEach(function (label, i) {
        const o = document.createElement('option');
        o.value = i; o.textContent = label;
        selDay.appendChild(o);
      });
      selDay.value = state.day;
      selDay.addEventListener('change', function () {
        state.day = parseInt(selDay.value, 10);
        $$('#dayChips .chip').forEach(function (c) {
          c.classList.toggle('is-on', parseInt(c.getAttribute('data-day'), 10) === state.day);
        });
        refreshDataViews();
      });
    }

    const rng = $('#cmpDepth');
    if (rng) {
      rng.addEventListener('input', function () {
        state.cmpDepth = parseInt(rng.value, 10);
        setText('#cmpDepthOut', DEPTHS[state.cmpDepth].toFixed(1) + ' m');
        drawComparison();
      });
    }

    const vp = $('#cmpViewport'), handle = $('#cmpHandle');
    const bw = $('#cmpWipe'), bs = $('#cmpSplit');
    function setMode(mode) {
      if (!vp) return;
      vp.setAttribute('data-mode', mode);
      if (bw) bw.classList.toggle('is-on', mode === 'wipe');
      if (bs) bs.classList.toggle('is-on', mode === 'split');
      drawComparison();
    }
    if (bw) bw.addEventListener('click', function () { setMode('wipe'); });
    if (bs) bs.addEventListener('click', function () { setMode('split'); });

    if (vp && handle) {
      let dragging = false;
      function moveTo(clientX) {
        const r = vp.getBoundingClientRect();
        const pct = clamp(((clientX - r.left) / r.width) * 100, 0, 100);
        vp.style.setProperty('--x', pct + '%');
        handle.setAttribute('aria-valuenow', Math.round(pct));
      }
      handle.addEventListener('pointerdown', function (e) {
        dragging = true;
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
      });
      handle.addEventListener('pointermove', function (e) { if (dragging) moveTo(e.clientX); });
      handle.addEventListener('pointerup', function (e) {
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      vp.addEventListener('pointerdown', function (e) {
        if (e.target === handle || handle.contains(e.target)) return;
        moveTo(e.clientX);
      });
      handle.addEventListener('keydown', function (e) {
        const cur = parseFloat(vp.style.getPropertyValue('--x')) || 50;
        if (e.key === 'ArrowLeft') { vp.style.setProperty('--x', clamp(cur - 3, 0, 100) + '%'); e.preventDefault(); }
        if (e.key === 'ArrowRight') { vp.style.setProperty('--x', clamp(cur + 3, 0, 100) + '%'); e.preventDefault(); }
      });
    }
    setText('#cmpDepthOut', DEPTHS[state.cmpDepth].toFixed(1) + ' m');
  }

  /* ============================= CSV export ============================ */
  function exportCsv() {
    const head = ['depth_m', 'rmse_c', 'bias_c', 'baseline_rmse_c', 'anomaly_corr', 'skill_vs_baseline_pct'];
    const lines = [
      '# OceanEmbed — held-out verification metrics (Team SANKALP #777, SIH 2026, PS 26066)',
      '# Domain: Bay of Bengal 80-90E / 10-20N · Holdout: 61 days, May-June 2021 · Source: GLORYS12V1',
      head.join(',')
    ];
    METRICS.forEach(function (m) {
      lines.push([
        m.d.toFixed(1), m.rmse.toFixed(2), m.bias.toFixed(2), m.base.toFixed(2),
        m.acc.toFixed(2), ((1 - m.rmse / m.base) * 100).toFixed(1)
      ].join(','));
    });
    lines.push('');
    lines.push('# Interactive sample days present in this dashboard: ' + DAYS.join(', '));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oceanembed_metrics_15depths.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ================================ boot =============================== */
  function redrawAll() {
    renderStack();
    drawSlice();
    drawProfile();
    drawSection();
    drawComparison();
    drawBarChart();
  }
  window.__oeRedrawAll = redrawAll;
  window.__oeState = state;

  function boot() {
    initBackground();
    initNav();
    initReveal();
    initCounters();
    initRotator();
    buildMetricsTable();
    drawBarChart();
    initBarHover();

    const c1 = $('#btnCsv'), c2 = $('#btnCsvFoot');
    if (c1) c1.addEventListener('click', exportCsv);
    if (c2) c2.addEventListener('click', exportCsv);

    if (!D || !D.pred) {
      const host = $('#explorer');
      if (host) {
        const c = $('#stackCanvas');
        if (c && c.parentNode) {
          const msg = document.createElement('div');
          msg.style.cssText = 'padding:60px 30px;text-align:center;color:#a8bedd;font-family:"JetBrains Mono",monospace';
          msg.innerHTML = 'Depth data not found.<br>Expected <code>site/data/oceanembed-data.js</code> to define <code>window.OE_DATA</code>.';
          c.parentNode.replaceChild(msg, c);
        }
      }
      return;
    }

    buildTextures();
    buildDayChips();
    buildDepthRail();
    buildLatSeg();
    initExplorer();
    initExplorerControls();
    initCompare();

    syncOfDepth();
    drawSection();
    drawComparison();
    loadCoast();

    let rt = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(redrawAll, 180);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

// Add to the bottom of script.js
(function() {
  const as = document.querySelector('.rp-disabled');
  const bob = document.querySelector('.rp-active');
  const D = window.OE_DATA;

  function updateGlobalStateFromTxTy(tx, ty) {
    if (!D || !window.__oeState) return;
    const NLON = D.lon.length, NLAT = D.lat.length;
    const lonTarget = D.lon[0] + tx * (D.lon[NLON-1] - D.lon[0]);
    const latTarget = D.lat[NLAT-1] - ty * (D.lat[NLAT-1] - D.lat[0]);
    
    let bestLon = 0, minL = 999;
    for(let i = 0; i < NLON; i++) {
      let d = Math.abs(D.lon[i] - lonTarget);
      if (d < minL) { minL = d; bestLon = i; }
    }
    
    let bestLat = 0, minA = 999;
    for(let i = 0; i < NLAT; i++) {
      let d = Math.abs(D.lat[i] - latTarget);
      if (d < minA) { minA = d; bestLat = i; }
    }
    
    if (window.__oeState.latIdx !== bestLat || window.__oeState.lonIdx !== bestLon) {
      window.__oeState.latIdx = bestLat;
      window.__oeState.lonIdx = bestLon;
      if (window.__oeRedrawAll) window.__oeRedrawAll();
    }
  }

  if (as) {
    as.addEventListener('click', () => {
      alert('Arabian Sea data is not available in the current proof-of-concept dataset. Please provide the Arabian Sea dataset to enable this region.');
    });
  }

  if (bob) {
    bob.addEventListener('click', () => {
      // Highlight it briefly or scroll to the stack
      bob.style.fill = 'rgba(34, 211, 238, 0.4)';
      setTimeout(() => bob.style.fill = '', 200);
      document.getElementById('explorer').scrollIntoView({ behavior: 'smooth' });
    });
  }

  const scv = document.getElementById('sliceCanvas');
  if (scv) {
    function updateSlicePick(e) {
      const r = scv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = scv.width / dpr, ch = scv.height / dpr;
      const lx = (e.clientX - r.left) * (cw / r.width);
      const ly = (e.clientY - r.top) * (ch / r.height);
      const pad = 26, top = 12;
      const pw = cw - pad * 2, ph = ch - top - pad;
      let tx = (lx - pad) / pw;
      let ty = (ly - top) / ph;
      tx = Math.max(0, Math.min(1, tx));
      ty = Math.max(0, Math.min(1, ty));
      updateGlobalStateFromTxTy(tx, ty);
    }
    scv.addEventListener('pointerdown', function(e) {
      try { scv.setPointerCapture(e.pointerId); } catch(err){}
      updateSlicePick(e);
    });
    scv.addEventListener('pointermove', function(e) {
      if (e.buttons > 0) updateSlicePick(e);
    });
  }
})();

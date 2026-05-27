/* ══════════════════════════════════════════════════════════════
   ORDERVAULT — APP.JS
   ══════════════════════════════════════════════════════════════ */

'use strict';

/* ─── GUN.JS REAL-TIME DB (P2P, zero server) ─── */
const GUN_PEERS = [
  'https://peer.wallie.io/gun',
  'https://gun-us.glitch.me/gun',
  'https://etogun.glitch.me/gun'
];
const gun = Gun({ peers: GUN_PEERS, localStorage: true });
const DB_NS = 'ordervault_v3'; // namespace prefix

/* ─── STATE ─── */
let currentRoom = null;
let editId = null;
let pendingPhotos = [];
let selectedPlat = 'CNFans';
let selectedStatus = 'In attesa';
let orderListener = null;
let ordersCache = {};  // id -> order object

/* ─── QUERY ─── */
const $ = id => document.getElementById(id);

/* ════════════════════════════════════════════
   IMMERSIVE STAR FIELD
════════════════════════════════════════════ */
(function StarField() {
  const canvas = $('star-canvas');
  const ctx = canvas.getContext('2d');
  let W, H;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  /* ─ Stars ─ */
  const STARS = 1200;
  const stars = Array.from({ length: STARS }, () => createStar(true));
  const shootingStars = [];

  function createStar(rand) {
    return {
      x:  (Math.random() - .5) * 3000,
      y:  (Math.random() - .5) * 3000,
      z:  rand ? Math.random() * 1800 : 1800,
      pz: 0,
      hue: Math.random() < .15 ? (Math.random() < .5 ? 195 : 270) : 0,
      size: Math.random() * 1.5 + .3
    };
  }

  let mx = 0, my = 0, tmx = 0, tmy = 0;
  let mVel = 0, prevMx = 0, prevMy = 0;

  window.addEventListener('mousemove', e => {
    tmx = (e.clientX / W - .5) * 2;
    tmy = (e.clientY / H - .5) * 2;
  });

  /* ─ Shooting stars ─ */
  function spawnShooting() {
    shootingStars.push({
      x: Math.random() * W * 1.4 - W * .2,
      y: Math.random() * H * .5,
      vx: (Math.random() * 6 + 4) * (Math.random() < .5 ? 1 : -1),
      vy: Math.random() * 3 + 1,
      len: Math.random() * 80 + 60,
      life: 1, hue: Math.random() < .5 ? 195 : 280
    });
    setTimeout(spawnShooting, 3000 + Math.random() * 6000);
  }
  setTimeout(spawnShooting, 2000);

  /* ─ Nebula blobs ─ */
  const nebulas = [
    { x: W * .2, y: H * .3, r: 300, h: 195, a: .025 },
    { x: W * .8, y: H * .7, r: 250, h: 270, a: .02 },
    { x: W * .5, y: H * .9, r: 200, h: 150, a: .015 }
  ];

  let frame = 0;

  function draw() {
    frame++;

    /* smooth mouse */
    const dx = tmx - mx; const dy = tmy - my;
    mx += dx * .04; my += dy * .04;
    const dmx = tmx - prevMx; const dmy = tmy - prevMy;
    mVel = Math.sqrt(dmx*dmx + dmy*dmy) * 60;
    prevMx = tmx; prevMy = tmy;
    const speed = 2.5 + mVel * 18;

    /* clear */
    ctx.fillStyle = 'rgba(0,0,8,1)';
    ctx.fillRect(0, 0, W, H);

    /* nebulas */
    for (const n of nebulas) {
      const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      grd.addColorStop(0, `hsla(${n.h},100%,60%,${n.a})`);
      grd.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
    }

    const cx = W / 2 + mx * 80;
    const cy = H / 2 + my * 80;

    /* warp star trails */
    for (const s of stars) {
      s.pz = s.z;
      s.z -= speed;
      if (s.z <= 0) { Object.assign(s, createStar(false)); s.pz = s.z; }

      const sx  = (s.x / s.z)  * W + cx;
      const sy  = (s.y / s.z)  * H + cy;
      const spx = (s.x / s.pz) * W + cx;
      const spy = (s.y / s.pz) * H + cy;

      if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) continue;

      const alpha = 1 - s.z / 1800;
      const sz    = Math.max(.3, (1 - s.z / 1800) * s.size * 2.5);

      const color = s.hue === 0
        ? `rgba(200,220,255,${alpha * .85})`
        : `hsla(${s.hue},100%,80%,${alpha * .9})`;

      const trailLen = Math.sqrt((sx-spx)**2 + (sy-spy)**2);
      if (trailLen > 1.5 && alpha > .3) {
        ctx.beginPath();
        ctx.moveTo(spx, spy);
        ctx.lineTo(sx, sy);
        ctx.strokeStyle = color;
        ctx.lineWidth = sz * .8;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, sz, 0, Math.PI * 2);
        ctx.fillStyle = color;
        if (s.hue !== 0 && alpha > .5) {
          ctx.shadowBlur = 4;
          ctx.shadowColor = `hsl(${s.hue},100%,70%)`;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    /* shooting stars */
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const ss = shootingStars[i];
      ss.x += ss.vx; ss.y += ss.vy; ss.life -= .012;
      if (ss.life <= 0) { shootingStars.splice(i, 1); continue; }
      const grad = ctx.createLinearGradient(ss.x, ss.y, ss.x - ss.vx * ss.len, ss.y - ss.vy * ss.len);
      grad.addColorStop(0, `hsla(${ss.hue},100%,90%,${ss.life})`);
      grad.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.moveTo(ss.x, ss.y);
      ctx.lineTo(ss.x - ss.vx * ss.len, ss.y - ss.vy * ss.len);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      /* head glow */
      ctx.beginPath();
      ctx.arc(ss.x, ss.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${ss.hue},100%,95%,${ss.life})`;
      ctx.shadowBlur = 8;
      ctx.shadowColor = `hsl(${ss.hue},100%,70%)`;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    requestAnimationFrame(draw);
  }
  draw();
})();

/* ════════════════════════════════════════════
   CUSTOM CURSOR
════════════════════════════════════════════ */
(function Cursor() {
  const dot   = $('cursor-dot');
  const ring  = $('cursor-ring');
  const trail = $('cursor-trail');
  let mx = -200, my = -200;
  let rx = -200, ry = -200;
  let vx = 0, vy = 0;
  let tx = -200, ty = -200;

  document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
  document.addEventListener('mousedown', () => dot.classList.add('clicking'));
  document.addEventListener('mouseup',   () => dot.classList.remove('clicking'));

  /* hover detection */
  const hoverSels = 'button, a, input, textarea, [data-action], .order-card, .feat-card';
  document.addEventListener('mouseover', e => {
    if (e.target.closest(hoverSels)) ring.classList.add('hover');
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest(hoverSels)) ring.classList.remove('hover');
  });

  function tick() {
    dot.style.left = mx + 'px';
    dot.style.top  = my + 'px';

    const dx = mx - rx; const dy = my - ry;
    vx += dx * .18; vy += dy * .18;
    vx *= .72; vy *= .72;
    rx += vx; ry += vy;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';

    /* trail (lazier) */
    tx += (mx - tx) * .06;
    ty += (my - ty) * .06;
    trail.style.left = tx + 'px';
    trail.style.top  = ty + 'px';

    requestAnimationFrame(tick);
  }
  tick();
})();

/* ════════════════════════════════════════════
   SCROLL REVEAL
════════════════════════════════════════════ */
(function ScrollReveal() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: .1 });
  document.querySelectorAll('.scroll-reveal').forEach(el => obs.observe(el));
})();

/* ════════════════════════════════════════════
   3D CARD TILT
════════════════════════════════════════════ */
function addTilt(card) {
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top)  / r.height;
    card.style.setProperty('--rx', `${(y - .5) * 14}deg`);
    card.style.setProperty('--ry', `${(.5 - x) * 14}deg`);
    card.style.setProperty('--mx', `${x * 100}%`);
    card.style.setProperty('--my', `${y * 100}%`);
  });
  card.addEventListener('mouseleave', () => {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
}

/* ════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════ */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
}

/* ════════════════════════════════════════════
   HOME BUTTON LOGIC
════════════════════════════════════════════ */
$('btn-create').addEventListener('click', createRoom);
$('btn-join-open').addEventListener('click', () => {
  const jb = $('join-box');
  jb.classList.toggle('hidden');
  if (!jb.classList.contains('hidden')) document.querySelectorAll('.ci')[0].focus();
});

/* code input: auto-advance + paste */
const ciInputs = document.querySelectorAll('.ci');
ciInputs.forEach((inp, i) => {
  inp.addEventListener('input', e => {
    const v = e.target.value.replace(/\D/g, '');
    e.target.value = v.slice(-1);
    $('join-err').classList.add('hidden');
    if (v && i < ciInputs.length - 1) ciInputs[i + 1].focus();
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !inp.value && i > 0) ciInputs[i - 1].focus();
    if (e.key === 'Enter') joinRoom();
  });
  inp.addEventListener('paste', e => {
    e.preventDefault();
    const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    t.split('').forEach((c, j) => { if (ciInputs[j]) ciInputs[j].value = c; });
    if (t.length === 6) $('btn-join-go').focus();
  });
});
$('btn-join-go').addEventListener('click', joinRoom);

/* ── CREATE ROOM ── */
async function createRoom() {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  // Write room marker to Gun
  gun.get(DB_NS).get('rooms').get(code).put({ created: Date.now(), v: 1 });
  // Show code modal
  $('big-code').textContent = code;
  openOverlay('ov-code');
  $('code-copy').onclick = () => {
    navigator.clipboard.writeText(code);
    toast('Codice copiato!', 'ok');
  };
  $('code-enter').onclick = () => { closeOverlay('ov-code'); enterRoom(code); };
}

/* ── JOIN ROOM ── */
function joinRoom() {
  const code = Array.from(ciInputs).map(i => i.value).join('');
  if (code.length < 6) { toast('Inserisci tutte e 6 le cifre', 'err'); return; }

  $('join-err').classList.add('hidden');
  $('join-loading').classList.remove('hidden');
  $('btn-join-go').disabled = true;

  // Gun: check if room key exists (timeout 4s)
  let resolved = false;
  const timer = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      $('join-loading').classList.add('hidden');
      $('btn-join-go').disabled = false;
      $('join-err').classList.remove('hidden');
      shake($('join-box'));
    }
  }, 4000);

  gun.get(DB_NS).get('rooms').get(code).once(data => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timer);
    $('join-loading').classList.add('hidden');
    $('btn-join-go').disabled = false;

    if (data && data.created) {
      enterRoom(code);
    } else {
      $('join-err').classList.remove('hidden');
      shake($('join-box'));
    }
  });
}

/* ── ENTER ROOM ── */
function enterRoom(code) {
  currentRoom = code;
  ordersCache = {};
  $('rcp-code').textContent = code;
  ciInputs.forEach(i => i.value = '');
  $('join-box').classList.add('hidden');
  showScreen('room');
  startRoomListener();
  renderOrders();
}

$('btn-back').addEventListener('click', () => {
  stopRoomListener();
  currentRoom = null; ordersCache = {};
  showScreen('home');
});

$('btn-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(currentRoom);
  toast('Codice copiato!', 'ok');
});

/* ════════════════════════════════════════════
   GUN ROOM LISTENER (real-time)
════════════════════════════════════════════ */
function startRoomListener() {
  if (orderListener) stopRoomListener();
  orderListener = gun
    .get(DB_NS).get('orders').get(currentRoom)
    .map()
    .on((data, id) => {
      if (!data || data._deleted) {
        delete ordersCache[id];
      } else {
        ordersCache[id] = { ...data, _id: id };
      }
      renderOrders();
    });
}

function stopRoomListener() {
  if (orderListener) {
    try { orderListener.off && orderListener.off(); } catch {}
    orderListener = null;
  }
  ordersCache = {};
}

/* ════════════════════════════════════════════
   ADD ORDER BUTTON
════════════════════════════════════════════ */
$('btn-add').addEventListener('click', () => openAddModal());
$('add-close').addEventListener('click', closeAddModal);
$('add-cancel').addEventListener('click', closeAddModal);
$('ov-add').addEventListener('click', e => { if (e.target === $('ov-add')) closeAddModal(); });
$('ov-detail').addEventListener('click', e => { if (e.target === $('ov-detail')) closeOverlay('ov-detail'); });
$('ov-code').addEventListener('click', e => { if (e.target === $('ov-code')) closeOverlay('ov-code'); });
$('detail-close').addEventListener('click', () => closeOverlay('ov-detail'));

/* ── PLATFORM / STATUS CHIPS ── */
$('plat-chips').addEventListener('click', e => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  $('plat-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  selectedPlat = btn.dataset.v;
});
$('status-chips').addEventListener('click', e => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  $('status-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  selectedStatus = btn.dataset.v;
});

/* ── PHOTO DROP ── */
const dropZone = $('drop-zone');
const dzInner  = $('dz-inner');
const dzPrev   = $('dz-previews');

dropZone.addEventListener('click', e => {
  if (e.target.classList.contains('dz-rm')) return;
  $('f-files').click();
});
$('f-files').addEventListener('change', e => handleFiles(e.target.files));
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    if (pendingPhotos.length >= 5) { toast('Max 5 foto', 'err'); return; }
    compressImage(file, 400, 400, .65, b64 => {
      pendingPhotos.push({ name: file.name, data: b64 });
      renderDZPreviews();
    });
  });
}

function compressImage(file, mw, mh, q, cb) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const scale = Math.min(1, mw / img.width, mh / img.height);
    const c = document.createElement('canvas');
    c.width  = Math.round(img.width  * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    cb(c.toDataURL('image/jpeg', q));
  };
  img.src = url;
}

function renderDZPreviews() {
  dzPrev.innerHTML = '';
  dzInner.style.display = pendingPhotos.length ? 'none' : '';
  pendingPhotos.forEach((p, i) => {
    const wrap = document.createElement('div'); wrap.className = 'dz-item';
    wrap.innerHTML = `<img class="dz-img" src="${p.data}" alt=""/>
      <button class="dz-rm" data-i="${i}">✕</button>`;
    dzPrev.appendChild(wrap);
  });
  dzPrev.querySelectorAll('.dz-rm').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      pendingPhotos.splice(+b.dataset.i, 1);
      renderDZPreviews();
    });
  });
}

/* ════════════════════════════════════════════
   AUTO-SEARCH: incolla link → cerca su UUFinds → riempie form
   ════════════════════════════════════════════ */

let autoTimer = null;
let lastSearchedUrl = '';

/* Trigger on input + paste */
$('f-link').addEventListener('input',  onLinkChange);
$('f-link').addEventListener('paste',  () => setTimeout(onLinkChange, 80));

function onLinkChange() {
  clearTimeout(autoTimer);
  const url = $('f-link').value.trim();
  if (!url.startsWith('http')) { fbHide(); return; }
  if (url === lastSearchedUrl) return; // same URL, skip
  fbShow('searching', '🔍 Ricerca su UUFinds...');
  autoTimer = setTimeout(() => runAutoFill(url), 700);
}

async function runAutoFill(url) {
  lastSearchedUrl = url;

  /* ── STEP 1: Vercel API (server-side, no CORS, su deploy) ── */
  const apiResult = await tryServerAPI(url);
  if (apiResult) return;                     // applyProductData + fbShow already called

  /* ── STEP 2: Fallback browser CORS proxy (locale/dev) ── */
  fbShow('searching', '🔍 Ricerca su UUFinds...');
  const uuf = await searchUUFinds(url);
  if (uuf && (uuf.title || uuf.photos.length)) {
    applyProductData(uuf);
    const n = uuf.photos.length;
    fbShow('ok', n ? `✓ Trovato su UUFinds — ${n} foto QC` : '✓ Nome trovato su UUFinds');
    return;
  }

  fbShow('searching', '🔍 Lettura pagina prodotto...');
  const pg = await scrapeProductPage(url);
  if (pg && (pg.title || pg.image)) {
    applyProductData({ title: pg.title, photos: pg.image ? [pg.image] : [], weight: 0, remote: true });
    fbShow('warn', '⚠ Info parziali — controlla e completa');
    return;
  }

  fbShow('manual', '✏ Prodotto non trovato — compila manualmente');
}

/* ── Vercel server-side API call ── */
async function tryServerAPI(url) {
  // Skip if running as a local file or on GitHub Pages (no /api/ endpoint)
  if (location.protocol === 'file:') return false;
  if (location.hostname.includes('github.io')) return false;

  try {
    fbShow('searching', '🔍 Ricerca prodotto + QC...');
    const res = await fetch(`/api/lookup?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(20000)
    });

    // 404 = not on Vercel, use CORS fallback
    if (res.status === 404) return false;
    if (!res.ok) return false;

    const data = await res.json();
    if (!data || data.error === 'invalid_url') return false;

    if (!data.source && (!data.sources || !data.sources.length)) {
      fbShow('manual', '✏ Prodotto non trovato — compila manualmente');
      return true;
    }

    /* Download images via /api/image proxy (merge from all sources) */
    let photos = [];
    if (data.images?.length > 0) {
      fbShow('searching', `⬇ Download ${data.images.length} foto da ${(data.sources || [data.source]).join(' + ')}...`);
      photos = await downloadViaAPI(data.images.slice(0, 6));
    }

    applyProductData({
      title:    data.title    || '',
      weight:   data.weight   || 0,
      price:    data.price    || 0,
      variants: data.variants || [],
      photos
    });

    /* Build source label */
    const srcList = (data.sources || [data.source]).filter(Boolean);
    const srcLabel = srcList.includes('uufinds') ? 'UUFinds 🎉' : srcList.includes('nicefinds') ? 'NiceFinds' : 'pagina prodotto';
    const multiSrc = srcList.length > 1 ? ` + ${srcList.length - 1} altra fonte` : '';

    fbShow(
      photos.length ? 'ok' : 'warn',
      photos.length
        ? `✓ ${srcLabel}${multiSrc} — ${photos.length} foto caricate`
        : data.title
          ? `✓ Nome trovato — nessuna foto QC disponibile`
          : '⚠ Niente trovato — compila manualmente'
    );
    return true;
  } catch (e) {
    // Network error = not reachable, try CORS fallback
    return false;
  }
}

/* Download images through /api/image proxy (server-side, no CORS) */
async function downloadViaAPI(imageUrls) {
  const results = [];
  await Promise.allSettled(imageUrls.map(async (url) => {
    try {
      const res = await fetch(`/api/image?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) return;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/') || blob.size < 800) return;
      const file = new File([blob], 'photo.jpg', { type: blob.type });
      const b64 = await new Promise(r => compressImage(file, 420, 420, .78, r));
      results.push({ name: 'photo.jpg', data: b64 });
    } catch { /* skip */ }
  }));
  return results;
}

/* ── Fetch bar helpers ── */
function fbShow(state, text) {
  const bar = $('fetch-bar');
  bar.className = `fetch-bar ${state}`;
  $('fb-text').textContent = text;
  const icons = { searching: '⟳', ok: '✓', warn: '⚠', manual: '✏' };
  const icon = $('fb-icon');
  icon.textContent = icons[state] || '';
  icon.className = 'fb-icon' + (state === 'searching' ? ' spin' : '');
}
function fbHide() {
  $('fetch-bar').className = 'fetch-bar hidden';
  $('variants-bar').classList.add('hidden');
  $('vb-chips').innerHTML = '';
  lastSearchedUrl = '';
}

/* ────────────────────────────────────────────
   SEARCH ON UUFINDS
   Tries multiple URL formats + CORS proxies.
   Extracts: title, photos (QC), weight.
   ──────────────────────────────────────────── */
async function searchUUFinds(productUrl) {
  /* Try several UUFinds search URL patterns */
  const candidates = [
    `https://www.uufinds.com/?s=${encodeURIComponent(productUrl)}`,
    `https://www.uufinds.com/s/?q=${encodeURIComponent(productUrl)}`,
    `https://www.uufinds.com/search?q=${encodeURIComponent(productUrl)}`
  ];

  const proxies = [
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`
  ];

  for (const searchUrl of candidates) {
    for (const makeProxy of proxies) {
      try {
        const proxyUrl = makeProxy(searchUrl);
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(9000) });
        let html = '';
        if (proxyUrl.includes('allorigins')) {
          const j = await res.json(); html = j.contents || '';
        } else {
          html = await res.text();
        }
        if (!html || html.length < 500) continue;

        const result = parseUUFindsHtml(html);
        if (result && (result.title || result.imageUrls.length)) {
          /* Download QC images via proxy */
          fbShow('searching', `⬇ Download ${result.imageUrls.length} foto QC...`);
          const photos = await downloadImages(result.imageUrls.slice(0, 5));
          return { title: result.title, photos, weight: result.weight };
        }
      } catch { /* try next */ }
    }
  }
  return null;
}

function parseUUFindsHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  /* Title: try OG first, then page heading, then <title> */
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.content || '';
  const h1      = doc.querySelector('h1, h2, .post-title, .entry-title, .item-title')?.textContent?.trim() || '';
  const rawTitle = ogTitle || h1 || doc.querySelector('title')?.textContent || '';
  const title = rawTitle.split(/\s*[-|—–]\s*/)[0].trim().slice(0, 120);

  /* Images: collect all <img> src, filter out tiny icons/logos */
  const imageUrls = [];
  const seen = new Set();
  doc.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || img.getAttribute('data-src') ||
                img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || '';
    if (!src) return;
    const abs = src.startsWith('//') ? 'https:' + src : src;
    if (!abs.startsWith('http')) return;
    if (seen.has(abs)) return;
    // Skip avatars, icons, logos, tiny images
    const lower = abs.toLowerCase();
    if (lower.includes('avatar') || lower.includes('logo') || lower.includes('icon') ||
        lower.includes('loading') || lower.includes('placeholder')) return;
    const w = img.naturalWidth  || parseInt(img.getAttribute('width'))  || 0;
    const h = img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
    if (w && h && (w < 80 || h < 80)) return; // skip tiny
    seen.add(abs);
    imageUrls.push(abs);
  });

  /* Weight: search visible text for patterns like "300g", "weight: 450g" */
  const bodyText = doc.body?.textContent || '';
  const wMatch =
    bodyText.match(/重量[：:]\s*(\d+\.?\d*)\s*[gG克]/) ||
    bodyText.match(/[Ww]eight[：:\s]+(\d+\.?\d*)\s*g/) ||
    bodyText.match(/(\d+\.?\d*)\s*(?:gram|grams|g)\b/);
  const weight = wMatch ? Math.round(parseFloat(wMatch[1])) : 0;

  return { title, imageUrls, weight };
}

/* ────────────────────────────────────────────
   FALLBACK: scrape product page directly
   ──────────────────────────────────────────── */
async function scrapeProductPage(productUrl) {
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(productUrl)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(productUrl)}`
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      let html = '';
      if (proxy.includes('allorigins')) { const j = await res.json(); html = j.contents || ''; }
      else html = await res.text();
      if (!html || html.length < 200) continue;

      const doc  = new DOMParser().parseFromString(html, 'text/html');
      const og   = n => doc.querySelector(`meta[property="og:${n}"]`)?.content || '';
      const meta = n => doc.querySelector(`meta[name="${n}"]`)?.content || '';

      const rawTitle = og('title') || meta('title') || doc.querySelector('title')?.textContent || '';
      const title = rawTitle.split(/\s*[-|—–]\s*/)[0].trim().slice(0, 120);
      const image = og('image') || '';

      if (title || image) return { title, image };
    } catch { /* try next */ }
  }
  return null;
}

/* ────────────────────────────────────────────
   DOWNLOAD + COMPRESS REMOTE IMAGES
   ──────────────────────────────────────────── */
async function downloadImages(urls) {
  const result = [];
  for (const url of urls) {
    try {
      const proxied = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      const res  = await fetch(proxied, { signal: AbortSignal.timeout(7000) });
      const blob = await res.blob();
      if (!blob.type.startsWith('image/') || blob.size < 1000) continue;
      const file = new File([blob], 'photo.jpg', { type: blob.type });
      const b64  = await new Promise(r => compressImage(file, 400, 400, .7, r));
      result.push({ name: 'qc.jpg', data: b64 });
    } catch { /* skip */ }
  }
  return result;
}

/* ── Apply fetched data to form ── */
function applyProductData({ title, photos, weight, remote, variants }) {
  if (title && !$('f-name').value)   $('f-name').value  = title;
  if (weight && !$('f-weight').value) $('f-weight').value = weight;
  if (photos && photos.length > 0 && pendingPhotos.length === 0) {
    if (remote) {
      downloadImages(photos).then(downloaded => {
        pendingPhotos.push(...downloaded);
        renderDZPreviews();
      });
    } else {
      pendingPhotos.push(...photos);
      renderDZPreviews();
    }
  }
  if (variants && variants.length > 0) renderVariants(variants);
}

/* ── Render found variants as clickable chips ── */
function renderVariants(variants) {
  const bar = $('variants-bar');
  const chips = $('vb-chips');
  chips.innerHTML = '';

  /* Group by type */
  const grouped = {};
  variants.forEach(v => {
    const type = v.type || 'variante';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(v);
  });

  Object.entries(grouped).forEach(([type, items]) => {
    if (Object.keys(grouped).length > 1) {
      const lbl = document.createElement('span');
      lbl.className = 'vb-type-label';
      lbl.textContent = type;
      chips.appendChild(lbl);
    }
    items.slice(0, 12).forEach(v => {
      const chip = document.createElement('button');
      chip.className = 'vb-chip';
      chip.type = 'button';
      chip.textContent = v.value;
      chip.title = `Clicca per aggiungere alle note`;
      chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        const notes = $('f-notes');
        const tag = `${type !== 'variante' ? type + ': ' : ''}${v.value}`;
        if (chip.classList.contains('selected')) {
          notes.value = notes.value ? notes.value + ', ' + tag : tag;
        } else {
          notes.value = notes.value.replace(new RegExp(',?\\s*' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').replace(/^,\s*/, '').trim();
        }
      });
      chips.appendChild(chip);
    });
  });

  bar.classList.remove('hidden');
}

async function downloadSingleImage(imageUrl) {
  try {
    const proxied = `https://corsproxy.io/?${encodeURIComponent(imageUrl)}`;
    const res  = await fetch(proxied, { signal: AbortSignal.timeout(8000) });
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return;
    const file = new File([blob], 'product.jpg', { type: blob.type });
    await new Promise(r => { compressImage(file, 400, 400, .7, b64 => { pendingPhotos.push({ name: 'product.jpg', data: b64 }); renderDZPreviews(); r(); }); });
  } catch { /* silent */ }
}

/* ── OPEN / CLOSE ADD MODAL ── */
function openAddModal(id = null) {
  editId = id;
  pendingPhotos = [];
  renderDZPreviews();
  selectedPlat = 'CNFans'; selectedStatus = 'In attesa';

  $('f-link').value = ''; $('f-name').value = '';
  $('f-price').value = ''; $('f-weight').value = '';
  $('f-notes').value = '';
  fbHide();
  lastSearchedUrl = '';
  clearTimeout(autoTimer);

  $('plat-chips').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.v === 'CNFans'));
  $('status-chips').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.v === 'In attesa'));

  if (id) {
    $('modal-title-text').textContent = '// MODIFICA ORDINE';
    const o = ordersCache[id];
    if (o) {
      $('f-link').value   = o.link    || '';
      $('f-name').value   = o.name    || '';
      $('f-price').value  = o.price   || '';
      $('f-weight').value = o.weight  || '';
      $('f-notes').value  = o.notes   || '';
      selectedPlat   = o.platform || 'CNFans';
      selectedStatus = o.status   || 'In attesa';
      $('plat-chips').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.v === selectedPlat));
      $('status-chips').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.v === selectedStatus));
      // restore photos
      if (o.photoCount) {
        for (let i = 0; i < o.photoCount; i++) {
          if (o['photo' + i]) pendingPhotos.push({ name: 'photo', data: o['photo' + i] });
        }
        renderDZPreviews();
      }
    }
  } else {
    $('modal-title-text').textContent = '// NUOVO ORDINE';
  }
  openOverlay('ov-add');
  setTimeout(() => $('f-link').focus(), 120);
}

function closeAddModal() { closeOverlay('ov-add'); }

/* ── SAVE ORDER ── */
$('add-save').addEventListener('click', saveOrder);
function saveOrder() {
  const name = $('f-name').value.trim();
  if (!name) { toast('Nome prodotto richiesto', 'err'); shake($('f-name')); return; }

  const id = editId || ('o' + Date.now() + Math.random().toString(36).slice(2, 5));

  // Build order object (Gun.js doesn't like nested arrays, so flatten photos)
  const order = {
    _id: id,
    name,
    link:      $('f-link').value.trim(),
    price:     parseFloat($('f-price').value)  || 0,
    weight:    parseInt($('f-weight').value)   || 0,
    platform:  selectedPlat,
    status:    selectedStatus,
    notes:     $('f-notes').value.trim(),
    photoCount: pendingPhotos.length,
    ts: editId ? (ordersCache[editId]?.ts || Date.now()) : Date.now(),
    updated: Date.now()
  };

  // Attach photos as individual keys (Gun.js compatible)
  pendingPhotos.forEach((p, i) => { order['photo' + i] = p.data; });
  // Clear old photos if editing and fewer photos now
  if (editId && ordersCache[editId]) {
    const old = ordersCache[editId];
    for (let i = pendingPhotos.length; i < (old.photoCount || 0); i++) {
      order['photo' + i] = null;
    }
  }

  // Save to Gun
  gun.get(DB_NS).get('orders').get(currentRoom).get(id).put(order);

  closeAddModal();
  toast(editId ? 'Ordine aggiornato ✓' : 'Ordine aggiunto ✓', 'ok');
  editId = null;
}

/* ── DELETE ORDER ── */
function deleteOrder(id) {
  if (!confirm('Eliminare questo ordine?')) return;
  gun.get(DB_NS).get('orders').get(currentRoom).get(id).put({ _deleted: true });
  delete ordersCache[id];
  renderOrders();
  toast('Ordine eliminato', 'err');
}

/* ════════════════════════════════════════════
   RENDER ORDERS
════════════════════════════════════════════ */
function renderOrders() {
  const grid = $('orders-grid');
  const orders = Object.values(ordersCache).filter(o => o && !o._deleted);
  orders.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // stats (animated)
  animNum($('sv-count'), orders.length, '');
  animNum($('sv-price'), orders.reduce((s, o) => s + (o.price || 0), 0), '€', true);
  animNum($('sv-weight'), orders.reduce((s, o) => s + (o.weight || 0), 0), 'g');
  const allArrived = orders.length > 0 && orders.every(o => o.status === 'Arrivato');
  const anyShipped = orders.some(o => o.status === 'Spedito');
  $('sv-status').textContent = allArrived ? '✅' : anyShipped ? '🚀' : orders.length ? '⏳' : '—';

  // clear old cards
  Array.from(grid.children).forEach(el => { if (el.id !== 'empty-msg') el.remove(); });
  $('empty-msg').style.display = orders.length ? 'none' : '';

  orders.forEach((o, idx) => {
    const card = buildCard(o, idx);
    grid.appendChild(card);
    addTilt(card);
  });
}

function animNum(el, target, suffix, isMoney) {
  const current = parseFloat(el.dataset.val || 0);
  if (Math.abs(current - target) < .01) {
    el.textContent = isMoney ? suffix + target.toFixed(2) : suffix ? target + suffix : target.toString();
    return;
  }
  el.dataset.val = target;
  const start = performance.now();
  const from = current;
  const dur = 500;
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const ease = 1 - Math.pow(1 - t, 3);
    const val = from + (target - from) * ease;
    el.textContent = isMoney ? suffix + val.toFixed(2) : suffix ? Math.round(val) + suffix : Math.round(val).toString();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function buildCard(o, idx) {
  const card = document.createElement('div');
  card.className = 'order-card';
  card.style.animationDelay = (idx * .06) + 's';
  card.dataset.id = o._id;

  const photos = [];
  for (let i = 0; i < (o.photoCount || 0); i++) {
    if (o['photo' + i]) photos.push(o['photo' + i]);
  }

  const thumb = photos.length
    ? `<img class="card-thumb" src="${photos[0]}" alt="${esc(o.name)}" loading="lazy"/>`
    : `<div class="card-thumb-placeholder">📦</div>`;

  const badge = statusBadge(o.status);

  card.innerHTML = `
    ${thumb}
    <div class="card-body">
      <div class="card-row1">
        <span class="card-name">${esc(o.name)}</span>
        <span class="card-plat">${esc(o.platform)}</span>
      </div>
      <div class="card-row2">
        ${o.price  ? `<span class="cprice">€${o.price.toFixed(2)}</span>` : ''}
        ${o.weight ? `<span>⚖ ${o.weight}g</span>` : ''}
        ${photos.length > 1 ? `<span>🖼 ${photos.length}</span>` : ''}
      </div>
      <span class="badge ${badge.cls}">${badge.lbl}</span>
      <div class="card-actions">
        <button class="ca-btn" data-action="view">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.8"/></svg>
          Dettagli
        </button>
        <button class="ca-btn" data-action="edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.8"/></svg>
          Modifica
        </button>
        <button class="ca-btn del" data-action="del">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="3,6 5,6 21,6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="1.8"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="1.8"/></svg>
        </button>
      </div>
    </div>`;

  card.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) { openDetail(o._id); return; }
    e.stopPropagation();
    if (btn.dataset.action === 'view')  openDetail(o._id);
    if (btn.dataset.action === 'edit')  openAddModal(o._id);
    if (btn.dataset.action === 'del')   deleteOrder(o._id);
  });

  return card;
}

/* ════════════════════════════════════════════
   DETAIL MODAL
════════════════════════════════════════════ */
function openDetail(id) {
  const o = ordersCache[id];
  if (!o) return;

  const photos = [];
  for (let i = 0; i < (o.photoCount || 0); i++) {
    if (o['photo' + i]) photos.push(o['photo' + i]);
  }

  const galleryHTML = photos.length
    ? `<div class="det-gallery">${photos.map(p => `<img src="${p}" alt=""/>`).join('')}</div>`
    : '';

  const linkHTML = o.link
    ? `<a href="${esc(o.link)}" target="_blank" rel="noopener noreferrer" class="det-link">
         ${esc(o.link.length > 60 ? o.link.slice(0, 60) + '…' : o.link)}
       </a>`
    : '<span style="opacity:.4">—</span>';

  const qcURL = o.link
    ? `https://www.uufinds.com/?q=${encodeURIComponent(o.link)}`
    : 'https://www.uufinds.com';

  const badge = statusBadge(o.status);
  const created = o.ts ? new Date(o.ts).toLocaleDateString('it-IT') : '—';

  $('detail-body').innerHTML = `
    ${galleryHTML}
    <div class="det-title">${esc(o.name)}</div>
    ${o.link ? `
    <a href="${qcURL}" target="_blank" rel="noopener" class="qc-btn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.8"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      Cerca QC su UUFinds
    </a>` : ''}
    <div class="det-grid">
      <div class="det-item"><label>Piattaforma</label><span>${esc(o.platform)}</span></div>
      <div class="det-item"><label>Stato</label><span class="badge ${badge.cls}">${badge.lbl}</span></div>
      <div class="det-item"><label>Prezzo</label><span style="color:var(--yellow);font-weight:700">${o.price ? '€' + o.price.toFixed(2) : '—'}</span></div>
      <div class="det-item"><label>Peso stimato</label><span>${o.weight ? o.weight + ' g' : '—'}</span></div>
      <div class="det-item"><label>Aggiunto</label><span>${created}</span></div>
      <div class="det-item"><label>Foto</label><span>${photos.length || '—'}</span></div>
      <div class="det-item" style="grid-column:1/-1"><label>Link</label>${linkHTML}</div>
    </div>
    ${o.notes ? `<div class="det-notes">${esc(o.notes)}</div>` : ''}
    <div class="modal-footer" style="margin-top:8px">
      <button class="btn-ghost sm" onclick="closeOverlay('ov-detail')">Chiudi</button>
      <button class="btn-primary sm" onclick="closeOverlay('ov-detail');openAddModal('${id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="1.8"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.8"/></svg>
        Modifica
      </button>
    </div>`;

  openOverlay('ov-detail');
}

/* ════════════════════════════════════════════
   OVERLAY HELPERS
════════════════════════════════════════════ */
function openOverlay(id)  { $(id).classList.remove('hidden'); }
function closeOverlay(id) { $(id).classList.add('hidden'); }

/* ════════════════════════════════════════════
   STATUS BADGE
════════════════════════════════════════════ */
function statusBadge(s) {
  const map = {
    'In attesa': { cls: 'b-wait',    lbl: '⏳ In attesa' },
    'Ordinato':  { cls: 'b-ordered', lbl: '📦 Ordinato' },
    'Spedito':   { cls: 'b-shipped', lbl: '🚀 Spedito' },
    'Arrivato':  { cls: 'b-arrived', lbl: '✅ Arrivato' }
  };
  return map[s] || map['In attesa'];
}

/* ════════════════════════════════════════════
   TOAST
════════════════════════════════════════════ */
function toast(msg, type = 'ok') {
  const c = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'ok' ? '✓' : '✕';
  el.innerHTML = `<span>${icon}</span> ${msg}`;
  c.appendChild(el);
  setTimeout(() => {
    el.classList.add('die');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 2600);
}

/* ════════════════════════════════════════════
   UTILS
════════════════════════════════════════════ */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shake(el) {
  el.style.animation = 'none'; void el.offsetHeight;
  el.style.animation = 'shake .45s ease';
  setTimeout(() => el.style.animation = '', 500);
}

/* inject shake keyframe */
document.head.insertAdjacentHTML('beforeend', `<style>
  @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(9px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}
</style>`);

/* ── URL deep-link: ?room=XXXXXX ── */
(function () {
  const p = new URLSearchParams(window.location.search);
  const r = p.get('room');
  if (r && r.length === 6 && /^\d+$/.test(r)) {
    // try to join directly
    gun.get(DB_NS).get('rooms').get(r).once(data => {
      if (data && data.created) enterRoom(r);
    });
  }
})();

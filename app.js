/* ══════════════════════════════════════════════════════════
   ORDERVAULT — APP LOGIC
   ══════════════════════════════════════════════════════════ */

'use strict';

/* ─── CONSTANTS ─── */
const STORAGE_KEY = 'ordervault_rooms';

/* ─── STATE ─── */
let currentRoom = null;
let editingOrderId = null;
let pendingPhotos = []; // array of { name, dataURL }
let selectedPlatform = 'CNFans';
let selectedStatus = 'In attesa';

/* ─── STORAGE HELPERS ─── */
function loadRooms() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveRooms(rooms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}
function getRoom(code) {
  const rooms = loadRooms();
  return rooms[code] || null;
}
function setRoom(code, data) {
  const rooms = loadRooms();
  rooms[code] = data;
  saveRooms(rooms);
}
function generateCode() {
  let code;
  const rooms = loadRooms();
  do { code = Math.floor(100000 + Math.random() * 900000).toString(); }
  while (rooms[code]);
  return code;
}

/* ─── DOM REFS ─── */
const $ = id => document.getElementById(id);
const screenHome = $('screen-home');
const screenRoom = $('screen-room');
const btnCreate = $('btn-create');
const btnJoinOpen = $('btn-join-open');
const joinBox = $('join-box');
const joinError = $('join-error');
const btnJoinConfirm = $('btn-join-confirm');
const codeInputs = document.querySelectorAll('.code-input');
const roomCodeDisplay = $('room-code-display');
const btnBack = $('btn-back');
const btnCopy = $('btn-copy');
const btnAddOrder = $('btn-add-order');
const ordersGrid = $('orders-grid');
const emptyState = $('empty-state');

// stats
const statCount = $('stat-count');
const statPrice = $('stat-price');
const statWeight = $('stat-weight');
const statStatus = $('stat-status');

// modal add
const modalOverlay = $('modal-overlay');
const modalClose = $('modal-close');
const modalCancel = $('modal-cancel');
const modalSave = $('modal-save');
const fName = $('f-name');
const fLink = $('f-link');
const fPrice = $('f-price');
const fWeight = $('f-weight');
const fNotes = $('f-notes');
const fPhotos = $('f-photos');
const photoDrop = $('photo-drop');
const dropInner = $('drop-inner');
const photoPreviews = $('photo-previews');
const platformSelect = $('platform-select');
const statusSelect = $('status-select');

// modal detail
const modalDetailOverlay = $('modal-detail-overlay');
const detailClose = $('detail-close');
const detailContent = $('detail-content');

// modal code
const modalCodeOverlay = $('modal-code-overlay');
const bigCode = $('big-code');
const codeBits = $('code-bits');
const codeCopyBtn = $('code-copy-btn');
const codeEnterBtn = $('code-enter-btn');

/* ════════════════════════════════════════════
   PARTICLES CANVAS
   ════════════════════════════════════════════ */
(function initParticles() {
  const canvas = $('particles');
  const ctx = canvas.getContext('2d');
  let W, H, particles = [], connections = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const count = Math.min(Math.floor(window.innerWidth / 14), 90);

  function rand(a, b) { return a + Math.random() * (b - a); }

  for (let i = 0; i < count; i++) {
    particles.push({
      x: rand(0, W), y: rand(0, H),
      vx: rand(-.3, .3), vy: rand(-.3, .3),
      r: rand(1, 2.5),
      color: Math.random() > .5 ? 'rgba(0,255,231,' : 'rgba(191,0,255,',
      alpha: rand(.3, .8)
    });
  }

  let mouse = { x: -1000, y: -1000 };
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          const alpha = (1 - dist / 130) * .12;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(0,255,231,${alpha})`;
          ctx.lineWidth = .8;
          ctx.stroke();
        }
      }
    }

    // mouse repel connections
    for (const p of particles) {
      const dx = p.x - mouse.x; const dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 100) {
        const alpha = (1 - dist / 100) * .35;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.strokeStyle = `rgba(191,0,255,${alpha})`;
        ctx.lineWidth = .8;
        ctx.stroke();
      }
    }

    // dots
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;

      // mouse repel
      const dx = p.x - mouse.x; const dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 80) {
        const force = (80 - dist) / 80 * .5;
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > 2) { p.vx = (p.vx / speed) * 2; p.vy = (p.vy / speed) * 2; }
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + p.alpha + ')';
      ctx.shadowBlur = 6;
      ctx.shadowColor = p.color + '.6)';
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    requestAnimationFrame(draw);
  }
  draw();
})();

/* ════════════════════════════════════════════
   SCROLL REVEAL
   ════════════════════════════════════════════ */
(function initScrollReveal() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: .12 });
  document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el));
})();

/* ════════════════════════════════════════════
   NAVIGATE
   ════════════════════════════════════════════ */
function showHome() {
  screenRoom.classList.remove('active');
  screenHome.classList.add('active');
  currentRoom = null;
}
function showRoom(code) {
  currentRoom = code;
  screenHome.classList.remove('active');
  screenRoom.classList.add('active');
  roomCodeDisplay.textContent = code;
  renderOrders();
}

/* ════════════════════════════════════════════
   HOME ACTIONS
   ════════════════════════════════════════════ */
btnCreate.addEventListener('click', () => {
  const code = generateCode();
  setRoom(code, { orders: [] });

  // show code modal
  bigCode.textContent = code;
  codeBits.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('div');
    d.className = 'code-bit';
    codeBits.appendChild(d);
  }
  modalCodeOverlay.classList.remove('hidden');

  codeCopyBtn.onclick = () => {
    navigator.clipboard.writeText(code).then(() => toast('Codice copiato!', 'success'));
  };
  codeEnterBtn.onclick = () => {
    modalCodeOverlay.classList.add('hidden');
    showRoom(code);
  };
});

btnJoinOpen.addEventListener('click', () => {
  joinBox.classList.toggle('hidden');
  if (!joinBox.classList.contains('hidden')) {
    codeInputs[0].focus();
  }
});

// code input auto-advance
codeInputs.forEach((inp, i) => {
  inp.addEventListener('input', e => {
    const val = e.target.value.replace(/\D/g, '');
    e.target.value = val.slice(-1);
    if (val && i < codeInputs.length - 1) codeInputs[i + 1].focus();
    joinError.classList.add('hidden');
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !inp.value && i > 0) codeInputs[i - 1].focus();
  });
  inp.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    text.split('').forEach((ch, j) => {
      if (codeInputs[j]) codeInputs[j].value = ch;
    });
    if (text.length === 6) btnJoinConfirm.focus();
  });
});

btnJoinConfirm.addEventListener('click', joinRoom);
function joinRoom() {
  const code = Array.from(codeInputs).map(i => i.value).join('');
  if (code.length < 6) { toast('Inserisci tutte e 6 le cifre', 'error'); return; }
  const room = getRoom(code);
  if (!room) {
    joinError.classList.remove('hidden');
    shakeEl(joinBox);
    return;
  }
  joinError.classList.add('hidden');
  showRoom(code);
}

/* ════════════════════════════════════════════
   ROOM ACTIONS
   ════════════════════════════════════════════ */
btnBack.addEventListener('click', () => {
  showHome();
  codeInputs.forEach(i => i.value = '');
  joinBox.classList.add('hidden');
});
btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(currentRoom).then(() => toast('Codice copiato!', 'success'));
});
btnAddOrder.addEventListener('click', () => openAddModal());

/* ════════════════════════════════════════════
   ADD/EDIT MODAL
   ════════════════════════════════════════════ */
function openAddModal(orderId = null) {
  editingOrderId = orderId;
  pendingPhotos = [];
  photoPreviews.innerHTML = '';
  selectedPlatform = 'CNFans';
  selectedStatus = 'In attesa';
  fName.value = ''; fLink.value = ''; fPrice.value = ''; fWeight.value = ''; fNotes.value = '';

  // reset platform / status btns
  platformSelect.querySelectorAll('.plat-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.plat === 'CNFans');
  });
  statusSelect.querySelectorAll('.status-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.status === 'In attesa');
  });

  if (orderId) {
    // editing
    const room = getRoom(currentRoom);
    const order = room.orders.find(o => o.id === orderId);
    if (order) {
      fName.value = order.name || '';
      fLink.value = order.link || '';
      fPrice.value = order.price || '';
      fWeight.value = order.weight || '';
      fNotes.value = order.notes || '';
      selectedPlatform = order.platform || 'CNFans';
      selectedStatus = order.status || 'In attesa';
      platformSelect.querySelectorAll('.plat-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.plat === selectedPlatform);
      });
      statusSelect.querySelectorAll('.status-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.status === selectedStatus);
      });
      if (order.photos) {
        pendingPhotos = order.photos.map(p => ({ ...p }));
        renderPhotoPreviews();
      }
    }
    document.querySelector('#modal-add .modal-title').textContent = 'Modifica Ordine';
  } else {
    document.querySelector('#modal-add .modal-title').textContent = 'Nuovo Ordine';
  }

  modalOverlay.classList.remove('hidden');
  setTimeout(() => fName.focus(), 100);
}

modalClose.addEventListener('click', closeAddModal);
modalCancel.addEventListener('click', closeAddModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeAddModal(); });
function closeAddModal() { modalOverlay.classList.add('hidden'); }

// platform select
platformSelect.querySelectorAll('.plat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    platformSelect.querySelectorAll('.plat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPlatform = btn.dataset.plat;
  });
});

// status select
statusSelect.querySelectorAll('.status-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    statusSelect.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedStatus = btn.dataset.status;
  });
});

// photo upload
photoDrop.addEventListener('click', e => {
  if (e.target.classList.contains('preview-remove')) return;
  fPhotos.click();
});
fPhotos.addEventListener('change', e => handleFiles(e.target.files));

photoDrop.addEventListener('dragover', e => { e.preventDefault(); photoDrop.classList.add('drag-over'); });
photoDrop.addEventListener('dragleave', () => photoDrop.classList.remove('drag-over'));
photoDrop.addEventListener('drop', e => {
  e.preventDefault(); photoDrop.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      pendingPhotos.push({ name: file.name, dataURL: e.target.result });
      renderPhotoPreviews();
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreviews() {
  photoPreviews.innerHTML = '';
  pendingPhotos.forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview-item';
    wrap.innerHTML = `<img class="preview-img" src="${p.dataURL}" alt="${p.name}" />
      <button class="preview-remove" data-idx="${i}">✕</button>`;
    photoPreviews.appendChild(wrap);
  });
  photoPreviews.querySelectorAll('.preview-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      pendingPhotos.splice(parseInt(btn.dataset.idx), 1);
      renderPhotoPreviews();
    });
  });
  dropInner.style.display = pendingPhotos.length ? 'none' : '';
}

modalSave.addEventListener('click', saveOrder);
function saveOrder() {
  const name = fName.value.trim();
  if (!name) { toast('Inserisci il nome del prodotto', 'error'); shakeEl(fName); return; }

  const room = getRoom(currentRoom);
  if (!room) return;

  const order = {
    id: editingOrderId || 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name,
    link: fLink.value.trim(),
    price: parseFloat(fPrice.value) || 0,
    weight: parseInt(fWeight.value) || 0,
    platform: selectedPlatform,
    status: selectedStatus,
    notes: fNotes.value.trim(),
    photos: pendingPhotos,
    createdAt: editingOrderId ? undefined : Date.now(),
    updatedAt: Date.now()
  };

  if (editingOrderId) {
    const idx = room.orders.findIndex(o => o.id === editingOrderId);
    if (idx !== -1) {
      order.createdAt = room.orders[idx].createdAt;
      room.orders[idx] = order;
    }
    toast('Ordine aggiornato ✓', 'success');
  } else {
    order.createdAt = Date.now();
    room.orders.push(order);
    toast('Ordine aggiunto ✓', 'success');
  }

  setRoom(currentRoom, room);
  closeAddModal();
  renderOrders();
}

/* ════════════════════════════════════════════
   RENDER ORDERS
   ════════════════════════════════════════════ */
function renderOrders() {
  const room = getRoom(currentRoom);
  if (!room) return;
  const orders = room.orders || [];

  // stats
  statCount.textContent = orders.length;
  statPrice.textContent = '€' + orders.reduce((s, o) => s + (o.price || 0), 0).toFixed(2);
  statWeight.textContent = orders.reduce((s, o) => s + (o.weight || 0), 0) + 'g';
  const allArrived = orders.length > 0 && orders.every(o => o.status === 'Arrivato');
  const anyShipped = orders.some(o => o.status === 'Spedito');
  statStatus.textContent = allArrived ? '✅' : anyShipped ? '🚀' : orders.length > 0 ? '⏳' : '—';

  // clear grid except empty state
  Array.from(ordersGrid.children).forEach(el => {
    if (el.id !== 'empty-state') el.remove();
  });

  emptyState.style.display = orders.length === 0 ? '' : 'none';

  orders.forEach((order, idx) => {
    const card = buildOrderCard(order, idx);
    ordersGrid.appendChild(card);
  });
}

function statusClass(status) {
  const map = { 'In attesa': 'attesa', 'Ordinato': 'ordinato', 'Spedito': 'spedito', 'Arrivato': 'arrivato' };
  return 'status-' + (map[status] || 'attesa');
}

function buildOrderCard(order, idx) {
  const card = document.createElement('div');
  card.className = 'order-card';
  card.style.animationDelay = (idx * 0.06) + 's';

  const imgHTML = order.photos && order.photos.length > 0
    ? `<img class="card-img" src="${order.photos[0].dataURL}" alt="${order.name}" loading="lazy" />`
    : `<div class="card-img-placeholder">📦</div>`;

  card.innerHTML = `
    ${imgHTML}
    <div class="card-body">
      <div class="card-header">
        <span class="card-name">${escHtml(order.name)}</span>
        <span class="card-platform">${escHtml(order.platform)}</span>
      </div>
      <div class="card-meta">
        ${order.price ? `<span class="price">€${order.price.toFixed(2)}</span>` : ''}
        ${order.weight ? `<span class="weight">⚖ ${order.weight}g</span>` : ''}
        ${order.photos && order.photos.length > 1 ? `<span>🖼 ${order.photos.length} foto</span>` : ''}
      </div>
      <span class="card-status ${statusClass(order.status)}">${order.status}</span>
      <div class="card-actions">
        <button class="card-btn" data-action="detail" data-id="${order.id}">👁 Dettagli</button>
        <button class="card-btn" data-action="edit" data-id="${order.id}">✏ Modifica</button>
        <button class="card-btn danger" data-action="delete" data-id="${order.id}">🗑</button>
      </div>
    </div>`;

  card.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) { openDetail(order.id); return; }
    e.stopPropagation();
    const { action, id } = btn.dataset;
    if (action === 'detail') openDetail(id);
    if (action === 'edit')   openAddModal(id);
    if (action === 'delete') deleteOrder(id);
  });

  return card;
}

/* ─── DELETE ─── */
function deleteOrder(id) {
  if (!confirm('Eliminare questo ordine?')) return;
  const room = getRoom(currentRoom);
  room.orders = room.orders.filter(o => o.id !== id);
  setRoom(currentRoom, room);
  renderOrders();
  toast('Ordine eliminato', 'error');
}

/* ════════════════════════════════════════════
   DETAIL MODAL
   ════════════════════════════════════════════ */
function openDetail(id) {
  const room = getRoom(currentRoom);
  const order = room.orders.find(o => o.id === id);
  if (!order) return;

  const galleryHTML = order.photos && order.photos.length > 0
    ? `<div class="detail-gallery">${order.photos.map(p => `<img src="${p.dataURL}" alt="${p.name}" />`).join('')}</div>`
    : '';

  const linkHTML = order.link
    ? `<a href="${escHtml(order.link)}" target="_blank" rel="noopener" class="detail-link">${escHtml(order.link.slice(0, 55))}…</a>`
    : '<span style="color:var(--text-muted)">—</span>';

  const notesHTML = order.notes
    ? `<div class="detail-notes">${escHtml(order.notes)}</div>`
    : '';

  const created = order.createdAt ? new Date(order.createdAt).toLocaleDateString('it-IT') : '—';

  detailContent.innerHTML = `
    ${galleryHTML}
    <div class="detail-title">${escHtml(order.name)}</div>
    <div class="detail-grid">
      <div class="detail-item"><label>Piattaforma</label><span>${escHtml(order.platform)}</span></div>
      <div class="detail-item"><label>Stato</label><span class="card-status ${statusClass(order.status)}">${order.status}</span></div>
      <div class="detail-item"><label>Prezzo</label><span style="color:var(--yellow);font-weight:700">${order.price ? '€' + order.price.toFixed(2) : '—'}</span></div>
      <div class="detail-item"><label>Peso stimato</label><span>${order.weight ? order.weight + ' g' : '—'}</span></div>
      <div class="detail-item"><label>Aggiunto il</label><span>${created}</span></div>
      <div class="detail-item"><label>Foto</label><span>${order.photos ? order.photos.length : 0}</span></div>
      <div class="detail-item full" style="grid-column:1/-1"><label>Link prodotto</label>${linkHTML}</div>
    </div>
    ${notesHTML}
    <div class="modal-actions" style="margin-top:4px">
      <button class="btn-outline" onclick="document.getElementById('modal-detail-overlay').classList.add('hidden')">Chiudi</button>
      <button class="btn-primary" onclick="document.getElementById('modal-detail-overlay').classList.add('hidden');openAddModal('${order.id}')">✏ Modifica</button>
    </div>`;

  modalDetailOverlay.classList.remove('hidden');
}

detailClose.addEventListener('click', () => modalDetailOverlay.classList.add('hidden'));
modalDetailOverlay.addEventListener('click', e => {
  if (e.target === modalDetailOverlay) modalDetailOverlay.classList.add('hidden');
});

/* ════════════════════════════════════════════
   TOAST
   ════════════════════════════════════════════ */
function toast(msg, type = 'success') {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type === 'success' ? '✓' : '✕'}</span> ${msg}`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    el.addEventListener('animationend', () => el.remove());
  }, 2800);
}

/* ════════════════════════════════════════════
   UTILS
   ════════════════════════════════════════════ */
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shakeEl(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake .4s ease';
  setTimeout(() => el.style.animation = '', 500);
}

/* Add shake keyframe dynamically */
(function() {
  const style = document.createElement('style');
  style.textContent = `@keyframes shake {
    0%,100%{transform:translateX(0)}
    20%{transform:translateX(-8px)}
    40%{transform:translateX(8px)}
    60%{transform:translateX(-6px)}
    80%{transform:translateX(6px)}
  }`;
  document.head.appendChild(style);
})();

/* ════════════════════════════════════════════
   CODE MODAL CLOSE
   ════════════════════════════════════════════ */
modalCodeOverlay.addEventListener('click', e => {
  if (e.target === modalCodeOverlay) modalCodeOverlay.classList.add('hidden');
});

/* ─── INIT ─── */
// Handle direct URL with code ?room=XXXXXX
(function checkURLRoom() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room');
  if (code && getRoom(code)) showRoom(code);
})();

import * as THREE from 'three';

const DAY_SCALE = 0.09;    // path length per day; both timelines share this date scale
const MIN_GAP = 6;        // closest two papers on one timeline may stand
const CARD_W = 3.6, CARD_H = 4.8, CARD_D = 0.12; // text-only (no image) cards
const CARD_AREA = 24;     // image cards keep the image's aspect ratio at this area
const CARD_SIDE = 2.8;    // how far cards stand from the path centre
const CARD_YAW = Math.atan2(-0.8, 0.6); // face the camera, which sits on the older side
const FOCUS_SCALE = 1.3, FOCUS_LIFT = 0.5; // the paper being looked at grows and rises
const BG = 0xf3f3f3;
const ACCENT = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
const TRACK_Z = { published: 0, preprint: 16 }; // two parallel timelines

const $ = (id) => document.getElementById(id);
const toTime = (d) => new Date(d).getTime();
// Citation counts come from Google Scholar, refreshed every two days by the get-citation-data
// workflow; papers.json keeps the counts from its last build in case that file can't be read
const SCHOLAR_DATA = 'https://raw.githubusercontent.com/penguinwang96825/blog/google-scholar-stats/gs_data.json';
const [papers, scholar] = await Promise.all([
  fetch('/assets/data/papers.json').then((r) => r.json()),
  fetch(SCHOLAR_DATA, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null),
]);
if (scholar) {
  const key = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''); // same matching as fetch_papers.py
  const counts = new Map(Object.values(scholar.publications).map((s) => [key(s.bib.title), s.num_citations]));
  papers.forEach((p) => { p.citations = counts.get(key(p.title)) ?? p.citations; });
}
papers.sort((a, b) => toTime(a.date) - toTime(b.date));
// Both timelines use one date scale, so a date sits at the same spot on each. Where papers on
// one timeline come closer than MIN_GAP, the scale stretches at that spot for both timelines.
const lastOn = {};
papers.forEach((p, i) => {
  const prev = papers[i - 1];
  p.x = prev ? prev.x + (toTime(p.date) - toTime(prev.date)) / 864e5 * DAY_SCALE : 0;
  if (lastOn[p.status]) p.x = Math.max(p.x, lastOn[p.status].x + MIN_GAP);
  lastOn[p.status] = p;
  p.z0 = TRACK_Z[p.status];
});
const tracks = Object.keys(TRACK_Z).map((s) => papers.filter((p) => p.status === s));
papers.forEach((p) => {
  p.id = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
});

// ---------- posters (canvas) ----------

function wrap(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const loadImage = (src) => new Promise((res) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => res(null);
  img.src = src;
});

async function makePoster(p) {
  const W = 600, H = 800, pad = 44;
  const c = document.createElement('canvas');
  c.width = W * 2; c.height = H * 2; // drawn at double resolution so the text stays sharp
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  const font = 'BlinkMacSystemFont, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = ACCENT;
  ctx.fillRect(pad, pad, 36, 5);
  ctx.fillStyle = '#111';
  ctx.font = `700 26px ${font}`;
  ctx.fillText(p.badge || 'arXiv preprint', pad, pad + 48);
  ctx.fillStyle = '#999';
  ctx.font = `400 20px ${font}`;
  ctx.fillText(p.date.replaceAll('-', '.'), pad, pad + 80);

  let y = pad + 120;
  const img = p.image && await loadImage(p.image);
  if (img) {
    const boxW = W - pad * 2, boxH = 330;
    const s = Math.min(boxW / img.width, boxH / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, pad + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
    y += boxH + 40;
  } else {
    y += 40;
  }

  const size = img ? 30 : 44;
  ctx.fillStyle = '#111';
  ctx.font = `800 ${size}px ${font}`;
  const lines = wrap(ctx, p.title, W - pad * 2);
  const maxLines = Math.floor((H - pad - 40 - y) / (size * 1.25));
  lines.slice(0, maxLines).forEach((l, i) => {
    const last = i === maxLines - 1 && lines.length > maxLines;
    ctx.fillText(last ? `${l}…` : l, pad, y + size + i * size * 1.25);
  });

  ctx.fillStyle = '#999';
  ctx.font = `400 18px ${font}`;
  ctx.fillText(p.authors.slice(0, 3).join(', ') + (p.authors.length > 3 ? ' et al.' : ''), pad, H - pad);
  return c;
}

function textTexture(text, { size = 64, color = '#111', weight = 700 } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${weight} ${size}px BlinkMacSystemFont, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 8;
  c.height = Math.ceil(size * 1.3);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 4, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: c.width / c.height };
}

// ---------- scene ----------

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 38, 80);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
scene.add(new THREE.AmbientLight(0xffffff, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(-5, 10, 8);
scene.add(sun);

// Map a date onto the path, on the scale shared by both timelines (interpolated between papers,
// so the stretched spots stretch the ticks too).
function dateToX(d) {
  const t = toTime(d), first = papers[0], last = papers.at(-1);
  if (t <= toTime(first.date)) return first.x - (toTime(first.date) - t) / 864e5 * DAY_SCALE;
  for (let i = 1; i < papers.length; i++) {
    const a = papers[i - 1], b = papers[i], ta = toTime(a.date), tb = toTime(b.date);
    if (t <= tb) return a.x + (tb === ta ? 0 : (t - ta) / (tb - ta)) * (b.x - a.x);
  }
  return last.x + (t - toTime(last.date)) / 864e5 * DAY_SCALE;
}

function flat(mesh, x, z, y = 0.01) {
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

const tickMat = new THREE.MeshBasicMaterial({ color: 0x9a9a9a });

function buildTrack(track) {
  const z0 = track[0].z0;
  // Both paths run over the same stretch of time, so they line up side by side.
  const X0 = papers[0].x - 14, X1 = papers.at(-1).x + 30;
  // Citation wave: path half-width bulges around each paper, amplitude ~ log(citations).
  const halfWidth = (x) => 0.32 + track.reduce(
    (s, p) => s + 0.55 * Math.log1p(p.citations) * Math.exp(-(((x - p.x) / 1.6) ** 2)), 0);
  const N = 800, pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const x = X0 + (X1 - X0) * i / N, w = halfWidth(x);
    pos.push(x, 0, z0 - w, x, 0, z0 + w);
    if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe0e0e0, side: THREE.DoubleSide })));

  // Monthly ticks + year labels lying on the ground
  const first = new Date(papers[0].date), last = new Date(papers.at(-1).date);
  for (let y = first.getFullYear(); y <= last.getFullYear(); y++) {
    for (let m = 0; m < 12; m++) {
      const x = dateToX(new Date(Date.UTC(y, m, 1)));
      if (x < X0 || x > X1) continue;
      const major = m === 0;
      flat(new THREE.Mesh(new THREE.PlaneGeometry(major ? 0.06 : 0.04, major ? 0.5 : 0.22), tickMat), x, z0);
      if (major) {
        const { tex, aspect } = textTexture(String(y), { size: 80, weight: 800 });
        const h = 0.75;
        flat(new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true })), x + h * aspect / 2 + 0.15, z0 + 1.1);
      }
    }
  }
}
tracks.forEach(buildTrack);

// Shadow blob texture
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

// Cards
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
const cards = [];
await Promise.all(papers.map(async (p) => {
  p.poster = await makePoster(p);
  const img = p.image && await loadImage(p.image);
  const tex = img ? new THREE.Texture(img) : new THREE.CanvasTexture(p.poster);
  tex.needsUpdate = true;
  const w = img ? Math.sqrt(CARD_AREA * img.width / img.height) : CARD_W;
  const h = img ? CARD_AREA / w : CARD_H;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, transparent: true });
  const edges = edgeMat.clone();
  edges.transparent = true;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, CARD_D),
    [edges, edges, edges, edges, front, edges]);
  const z = p.z0 - CARD_SIDE;
  mesh.position.set(p.x, h / 2 + 0.05, z);
  mesh.rotation.y = CARD_YAW;
  mesh.userData.paper = p;
  scene.add(mesh);

  const shadow = flat(new THREE.Mesh(new THREE.PlaneGeometry(w * 1.5, 1.6),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })), p.x + 0.4, z, 0.005);
  shadow.rotation.z = CARD_YAW;

  const marker = flat(new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.5),
    new THREE.MeshBasicMaterial({ color: ACCENT })), p.x, p.z0, 0.012);

  cards.push({ mesh, mats: [front, edges], shadow, marker, w, h, paper: p, opacity: 1, scale: 1 });
}));
cards.sort((a, b) => a.paper.x - b.paper.x);

// ---------- state ----------

let status = 'published';
let view = 'timeline';
let list = [];        // papers of the selected status, oldest first
let pos = 0;          // float index into list (camera target)
let target = 0;
let camX = 0, camZ = 0;
let snapTimer;

function selectStatus(s, keepPaper) {
  // switching timelines stays at the same time: the paper nearest the one in view
  const when = list.length ? toTime(focused().date) : null;
  status = s;
  list = papers.filter((p) => p.status === s);
  const nearest = () => list.reduce((best, p, j) => Math.abs(toTime(p.date) - when) < Math.abs(toTime(list[best].date) - when) ? j : best, 0);
  const i = keepPaper ? list.indexOf(keepPaper) : when === null ? list.length - 1 : nearest();
  target = pos = Math.max(0, i);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.status === s));
  renderYears();
  renderGrid();
  updateFocus();
}

const focused = () => list[Math.round(target)];

// A float index into list <-> a position along the path (papers are no longer evenly spaced)
function indexToX(f) {
  const i = Math.floor(f), a = list[i].x;
  return i + 1 < list.length ? a + (list[i + 1].x - a) * (f - i) : a;
}
function xToIndex(x) {
  if (x <= list[0].x) return 0;
  for (let i = 1; i < list.length; i++) {
    if (x <= list[i].x) return i - 1 + (x - list[i - 1].x) / (list[i].x - list[i - 1].x);
  }
  return list.length - 1;
}

function updateFocus() {
  const p = focused();
  $('focus-meta').textContent = `${p.status === 'published' ? 'Published' : 'Preprint'} · ${p.year}`;
  $('focus-date').textContent = p.date.replaceAll('-', '.');
  $('focus-title').textContent = p.title;
  $('focus-type').textContent = p.badge || 'arXiv';
  document.querySelectorAll('#years li').forEach((li) => li.classList.toggle('active', +li.dataset.year === p.year));
  measureFree(); // a longer title makes the panel taller on phones
}

function renderYears() {
  const counts = {};
  list.forEach((p) => { counts[p.year] = (counts[p.year] || 0) + 1; });
  $('years').innerHTML = Object.keys(counts).sort().map((y) => `<li data-year="${y}">${y}<sup>${counts[y]}</sup></li>`).join('');
}

function goTo(i) {
  target = THREE.MathUtils.clamp(i, 0, list.length - 1);
  updateFocus();
}

// ---------- modal ----------

const LINK_LABELS = { pdf: 'PDF', code: 'GitHub', huggingface: 'HuggingFace', website: 'Website', demo: 'Demo' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function openPaper(p) {
  $('modal-image').innerHTML = p.image ? `<img src="${p.image}" alt="">` : '';
  if (!p.image) $('modal-image').appendChild(p.poster.cloneNode()).getContext('2d').drawImage(p.poster, 0, 0);
  $('modal-meta').textContent = `${p.status === 'published' ? 'Published' : 'Preprint'} / ${p.badge || 'arXiv'}`;
  $('modal-title').textContent = p.title;
  $('modal-date').textContent = p.date.replaceAll('-', '.');
  $('modal-authors').innerHTML = p.authors.map((a) => a === 'Yang Wang' ? `<b>${esc(a)}</b>` : esc(a)).join(', ');
  $('modal-cite').textContent = `Citations: ${p.citations}`;
  $('modal-links').innerHTML = Object.entries(p.links).map(([k, v], i) =>
    `<a class="btn${i ? ' ghost' : ''}" href="${esc(v)}" target="_blank" rel="noopener">${LINK_LABELS[k] || k} ↗</a>`).join('');
  $('modal').hidden = false;
  history.replaceState(null, '', `#${p.id}`);
}

function closePaper() {
  $('modal').hidden = true;
  history.replaceState(null, '', location.pathname);
}

// ---------- grid view ----------

function renderGrid() {
  $('grid').innerHTML = '';
  [...papers].reverse().forEach((p) => {
    const cell = document.createElement('div');
    cell.className = `cell${p.status === status ? '' : ' dim'}`;
    const img = new Image();
    img.className = 'poster';
    img.src = p.poster.toDataURL('image/jpeg', 0.85);
    cell.append(img);
    cell.insertAdjacentHTML('beforeend', `<div class="cell-title">${esc(p.title)}</div><div class="cell-meta">${esc(p.badge || 'arXiv')} · ${p.date}</div>`);
    cell.onclick = () => openPaper(p);
    $('grid').append(cell);
  });
}

function setView(v) {
  view = v;
  $('grid').hidden = v !== 'grid';
  $('focus').style.opacity = v === 'grid' ? 0 : 1;
  document.querySelectorAll('.view-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
}

// ---------- input ----------

addEventListener('wheel', (e) => {
  if (view !== 'timeline' || !$('modal').hidden) return;
  e.preventDefault();
  // scroll up = newer paper, scroll down = older
  target = THREE.MathUtils.clamp(target - e.deltaY * 0.004, 0, list.length - 1);
  updateFocus();
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => goTo(Math.round(target)), 140);
}, { passive: false });

let touchY = null;
addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
addEventListener('touchmove', (e) => {
  if (touchY === null || view !== 'timeline' || !$('modal').hidden) return;
  const y = e.touches[0].clientY;
  target = THREE.MathUtils.clamp(target + (y - touchY) * 0.012, 0, list.length - 1);
  touchY = y;
  updateFocus();
}, { passive: true });
addEventListener('touchend', () => { touchY = null; goTo(Math.round(target)); });

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePaper();
  if (!$('modal').hidden || view !== 'timeline') return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') goTo(Math.round(target) + 1);
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') goTo(Math.round(target) - 1);
  if (e.key === 'Enter') openPaper(focused());
});

const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2(-9, -9);
let hovered = null, downAt = null;
let drag = null; // { x, y, moved } while the left mouse button holds the path

function pick(e) {
  pointer.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const hit = ray.intersectObjects(cards.map((c) => c.mesh), false)[0];
  return hit ? cards.find((c) => c.mesh === hit.object) : null;
}

// Screen pixels covered by one unit of path at the paper in view, as a 2D direction
const toScreen = (v) => { v.project(camera); return new THREE.Vector2((v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight); };
function pathOnScreen() {
  const x = indexToX(target), z = TRACK_Z[status];
  return toScreen(new THREE.Vector3(x + 1, 0, z)).sub(toScreen(new THREE.Vector3(x, 0, z)));
}

canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) {
      drag.moved = true;
      canvas.style.cursor = 'grabbing';
    }
    if (drag.moved) {
      // the path follows the cursor: only the part of the move along the path counts
      const along = pathOnScreen();
      const units = ((e.clientX - drag.x) * along.x + (e.clientY - drag.y) * along.y) / along.lengthSq();
      target = xToIndex(indexToX(target) - units);
      updateFocus();
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    return;
  }
  hovered = pick(e);
  canvas.style.cursor = hovered ? 'pointer' : view === 'timeline' ? 'grab' : '';
});
canvas.addEventListener('pointerdown', (e) => {
  downAt = [e.clientX, e.clientY];
  if (e.pointerType === 'mouse' && e.button === 0 && view === 'timeline' && $('modal').hidden) {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (drag) {
    const moved = drag.moved;
    drag = null;
    canvas.style.cursor = '';
    if (moved) { goTo(Math.round(target)); return; } // settle on the nearest paper
  }
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const c = pick(e);
  if (!c) return;
  if (c.paper.status !== status) selectStatus(c.paper.status, c.paper);
  else goTo(list.indexOf(c.paper));
  openPaper(c.paper);
});

canvas.addEventListener('pointercancel', () => { drag = null; });

$('focus-open').onclick = () => openPaper(focused());
$('modal-close').onclick = closePaper;
$('modal').onclick = (e) => { if (e.target === $('modal')) closePaper(); };
document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => selectStatus(b.dataset.status); });
document.querySelectorAll('.view-toggle button').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
$('years').onclick = (e) => {
  const li = e.target.closest('li');
  if (li) goTo(list.findLastIndex((p) => p.year === +li.dataset.year));
};
$('share').onclick = async () => {
  const url = `${location.origin}${location.pathname}#${$('modal').hidden ? focused().id : location.hash.slice(1)}`;
  try { await navigator.clipboard.writeText(url); } catch { prompt('Copy link', url); return; }
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 1500);
};

// ---------- loop ----------

// The part of the screen the text panel leaves free (beside it, or below it on phones); the
// paper in view is centred there by shifting the camera's view
let free = { w: innerWidth, h: innerHeight };
function measureFree() {
  const r = $('focus').getBoundingClientRect();
  const wide = innerWidth >= 760;
  free = wide ? { w: innerWidth - r.right, h: innerHeight } : { w: innerWidth, h: innerHeight - r.bottom };
  camera.setViewOffset(innerWidth, innerHeight, wide ? -r.right / 2 : 0, wide ? 0 : -r.bottom / 2, innerWidth, innerHeight);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = innerWidth < 760 ? 48 : 32;
  measureFree();
}
addEventListener('resize', resize);
resize();

const fromHash = papers.find((p) => p.id === location.hash.slice(1));
selectStatus(fromHash ? fromHash.status : 'published', fromHash);
if (fromHash) openPaper(fromHash);
camX = list[Math.round(target)].x;
camZ = TRACK_Z[status];

const lookAt = new THREE.Vector3();
const VIEW = new THREE.Vector3(-15, 13, 17), VIEW_DIST = VIEW.length(); // camera offset from the paper in view
VIEW.normalize();
let lookY = 3, dist = VIEW_DIST;
renderer.setAnimationLoop(() => {
  // while dragging the path follows the cursor closely; otherwise it glides
  const dragging = drag?.moved;
  pos += (target - pos) * (dragging ? 0.35 : 0.12);
  camX += (indexToX(pos) - camX) * (dragging ? 0.35 : 0.08);
  camZ += (TRACK_Z[status] - camZ) * 0.08;

  // the paper in view stands in the middle of the free part of the screen (see measureFree)
  const fp = focused();
  const fc = cards.find((c) => c.paper === fp);
  lookY += ((fc ? fc.h * FOCUS_SCALE / 2 + 0.05 + FOCUS_LIFT : 3) - lookY) * 0.1;
  // back off when the free part of the screen is too small for it
  const perUnit = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))); // pixels per unit at distance 1
  const need = fc ? Math.max(fc.w * FOCUS_SCALE * perUnit / (0.9 * free.w), fc.h * FOCUS_SCALE * perUnit / (0.8 * free.h)) : 0;
  dist += (Math.max(VIEW_DIST, need) - dist) * 0.1;
  const cardZ = camZ - CARD_SIDE;
  lookAt.set(camX, lookY, cardZ);
  camera.position.copy(lookAt).addScaledVector(VIEW, dist);
  camera.lookAt(lookAt);

  for (const c of cards) {
    const isFocus = c.paper === fp;
    // the paper in view at full strength, the rest of its timeline faded, the other timeline nearly gone
    // (and any card right in front of the camera, which would only block the view)
    const want = (c.paper.status !== status ? 0.12 : isFocus ? 1 : 0.5) * THREE.MathUtils.smoothstep(c.mesh.position.distanceTo(camera.position), 8, 14);
    c.opacity += (want - c.opacity) * 0.12;
    c.mats.forEach((m) => { m.opacity = c.opacity; m.depthTest = !isFocus; });
    c.shadow.material.opacity = c.opacity;
    c.marker.visible = isFocus;
    // it also grows, rises and draws over its neighbours
    const s = isFocus ? FOCUS_SCALE : c === hovered ? 1.06 : 1;
    c.scale += (s - c.scale) * 0.15;
    c.mesh.scale.setScalar(c.scale);
    c.mesh.position.y = c.h / 2 * c.scale + 0.05 + Math.max(0, (c.scale - 1) / (FOCUS_SCALE - 1)) * FOCUS_LIFT;
    c.mesh.renderOrder = isFocus ? 10 : 0;
  }
  renderer.render(scene, camera);
});

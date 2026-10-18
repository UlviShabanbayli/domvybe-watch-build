// DV65 · ATELIER H. — page controller: scroll → assembly progress, state tiles, find-a-part, bag, fallback.
// Scroll is the only motor: nothing assembles unless the visitor scrolls (or asks a control to scroll for them).
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const KEY = 'dv65a.bag';

// storage: versioned keys only; wipe anything older from this component
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('dv65') && !k.startsWith('dv65a.')) localStorage.removeItem(k); } } catch { /* ignore */ }

const build = $('#build'), canvas = $('#watch'), steps = $$('.step'), finalBox = $('#final'), addBtn = $('#add-btn'), cue = $('#cue');
const live = $('#live'), railLabel = $('#rail-label'), rail = $$('.rail i');
const STAGES = [
  { from: 0, to: 0.2, label: 'Exploded view', say: 'Step 1 of 3: exploded view. Scroll to assemble.', aria: 'An ATELIER H. watch in exploded view: dial, hands, rotor and movement parts floating apart from the case.' },
  { from: 0.2, to: 0.8, label: 'Gears & case locking', say: 'Step 2 of 3: the movement is being assembled and the case is closing.', aria: 'The ATELIER H. movement being assembled inside the case: gold gear wheels, bridges with rubies, the balance.' },
  { from: 0.8, to: 1.0001, label: 'Ticking assembly', say: 'Step 3 of 3: fully assembled. The watch is running on your local time.', aria: 'The finished ATELIER H. Calibre AH-01: rose-gold bezel, blue fumé sunburst dial, taupe leather strap, hands showing the current time.' },
];
const stageOf = (p) => STAGES.findIndex((s) => p >= s.from && p < s.to);

let stage = null, P = 0, stageIdx = -1, alive = false;
let resolveReady; const ready = new Promise((r) => { resolveReady = r; });

function progressFromScroll() {
  const r = build.getBoundingClientRect();
  const span = build.offsetHeight - innerHeight;
  return Math.min(1, Math.max(0, -r.top / Math.max(1, span)));
}
function scrollToP(p, smooth = !reduced) {
  const top = build.offsetTop + p * (build.offsetHeight - innerHeight);
  scrollTo({ top: Math.round(top), behavior: smooth ? 'smooth' : 'auto' });
}

// ---------- UI that follows progress ----------
function paint(p) {
  P = p;
  const i = stageOf(p);
  if (i !== stageIdx) {
    stageIdx = i;
    steps.forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    railLabel.textContent = `0${i + 1} · ${STAGES[i].label}`;
    canvas.setAttribute('aria-label', STAGES[i].aria);
    if (booted) live.textContent = STAGES[i].say;
    if (noGL) setFallback(i);
  }
  STAGES.forEach((s, k) => {
    const f = Math.min(1, Math.max(0, (p - s.from) / (Math.min(1, s.to) - s.from)));
    const m = steps[k]?.querySelector('.meter i'); if (m) m.style.transform = `scaleX(${f.toFixed(3)})`;
    if (rail[k]) rail[k].style.setProperty('--f', f.toFixed(3));
  });
  cue.classList.toggle('gone', p > 0.025);
  const done = p >= 0.955;
  if (done !== alive) {
    alive = done;
    finalBox.classList.toggle('on', done);
    finalBox.setAttribute('aria-hidden', String(!done));
    addBtn.tabIndex = done ? 0 : -1;
  }
}
let booted = false;

// ---------- WebGL or the still fallback ----------
let noGL = false;
function hasGL2() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } }
function setFallback(i) {
  const img = $('#fallback');
  const phone = innerWidth / innerHeight < 0.82;
  img.src = `assets/renders/${phone ? 'phone' : 'hero'}_${['start', 'progress', 'final'][i]}.webp`;
  img.alt = STAGES[i].aria;
}

async function boot() {
  if (new URLSearchParams(location.search).has('nogl') || !hasGL2()) {
    noGL = true; document.documentElement.classList.add('no-gl'); canvas.hidden = true; $('#fallback').hidden = false;
    paint(progressFromScroll()); booted = true; resolveReady(); return;
  }
  // the dial print uses Lato: wait for it (bounded) so the canvas texture never falls back to a system face
  await Promise.race([Promise.all([document.fonts.load('400 40px Lato'), document.fonts.load('700 40px Lato')]), new Promise((r) => setTimeout(r, 1800))]);
  const { createStage } = await import('./stage.js');
  const qs = new URLSearchParams(location.search);
  stage = await createStage(canvas, { reduced, maxDpr: 2, centre: qs.get('frame') === 'centre' });
  const fit = () => { const r = canvas.parentElement.getBoundingClientRect(); stage.resize(r.width, r.height); };
  fit();
  stage.warm();
  const p0 = progressFromScroll();
  stage.jumpProgress(p0);
  paint(p0);
  stage.onFrame((p) => paint(p));
  new ResizeObserver(fit).observe(canvas.parentElement);
  new IntersectionObserver(([e]) => stage.setVisible(e.isIntersecting), { rootMargin: '50px' }).observe(build);
  document.addEventListener('visibilitychange', () => stage.setVisible(!document.hidden));
  // pointer parallax (mouse only): the light slides over the metal as you move
  if (!reduced) build.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; stage.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1); }, { passive: true });
  build.addEventListener('pointerleave', () => stage.setPointer(0, 0));
  if (!qs.has('noadapt')) adaptQuality();
  booted = true;
  prewarmSheets();
  resolveReady();
}

// the first open of a sheet paints its panel, shadow and contents for the first time (≈ 11 ms of main thread on a phone):
// do that once, invisibly, while the page is idle after boot
function prewarmSheets() {
  const go = () => {
    const els = [...document.querySelectorAll('.sheet')];
    const real = bag; bag = Math.max(1, real); renderBag(); renderParts('');   // the filled bag is the heavier layout
    for (const el of els) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; el.hidden = false; el.setAttribute('aria-hidden', 'true'); }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bag = real; renderBag(); for (const el of els) { el.hidden = true; el.style.opacity = ''; el.style.pointerEvents = ''; el.removeAttribute('aria-hidden'); } }));
  };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 600 }); else setTimeout(go, 200);
}

// step the pixel ratio down if this device cannot hold the frame rate while the scene moves. Re-allocating the render
// targets costs one long frame, so the change waits until the stage is at rest (never mid-scroll), and happens twice at most.
function adaptQuality() {
  let last = 0, long = 0, n = 0, scale = 1, pending = 0, steps = 0;
  const watch = (t) => {
    if (last && stage.st.raf) { n++; if (t - last > 1000 / 50) long++; }
    last = t;
    if (n >= 120) { if (long > n / 3 && steps + (pending ? 1 : 0) < 2) pending = Math.max(0.7, scale - 0.15); n = long = 0; }
    if (pending && performance.now() - lastScroll > 600 && Math.abs(stage.st.target - stage.st.shown) < 1e-4) { scale = pending; pending = 0; steps++; stage.setQuality(scale); }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}
let lastScroll = 0;

addEventListener('scroll', () => { lastScroll = performance.now(); const p = progressFromScroll(); if (stage) stage.setProgress(p); else paint(p); if (reduced || noGL) paint(p); }, { passive: true });

// ---------- tiles, cue, menu ----------
steps.forEach((b) => b.addEventListener('click', () => scrollToP(+b.dataset.p)));
cue.addEventListener('click', (e) => { e.preventDefault(); scrollToP(0.45); });
$('.wordmark').addEventListener('click', (e) => { e.preventDefault(); scrollToP(0); });

const menuBtn = $('#menu-btn'), menu = $('#menu');
function setMenu(open) {
  menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('a, button').focus();
}
menuBtn.addEventListener('click', () => setMenu(menu.hidden));
menu.addEventListener('click', (e) => {
  const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); setMenu(false); scrollToP(+a.dataset.go); }
  if (e.target.closest('[data-open-search]')) { setMenu(false); openSheet('search', menuBtn); }
});
menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setMenu(false); menuBtn.focus(); } });
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn && !menuBtn.contains(e.target)) setMenu(false); });

// ---------- sheets (non-modal dialogs with a focus trap; showModal() inerts the whole page and costs frames) ----------
let opener = null;
function openSheet(id, from) {
  const el = $('#' + id); opener = from || document.activeElement;
  el.hidden = false;
  if (id === 'search') { $('#q').value = ''; renderParts(''); $('#q').focus(); }
  if (id === 'bag') { renderBag(); (el.querySelector('.cta, .ghost, [data-close]')).focus(); }
}
function closeSheet(el) { el.hidden = true; if (opener && opener.focus) opener.focus(); }
$$('.sheet').forEach((el) => {
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) closeSheet(el); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(el); return; }
    if (e.key !== 'Tab') return;
    const f = $$('button:not([disabled]), input, [href], [tabindex="0"]', el).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
});
$('#search-btn').addEventListener('click', (e) => openSheet('search', e.currentTarget));
$('#bag-btn').addEventListener('click', (e) => openSheet('bag', e.currentTarget));

// ---------- find a part (combobox) ----------
let parts = [];
function partList() {
  if (parts.length) return parts;
  const fixed = [{ label: 'Case', p: 0, note: 'in place' }, { label: 'Bezel', p: 0, note: 'in place' }, { label: 'Crown', p: 0, note: 'in place' }];
  const seen = new Set();
  const moving = stage ? stage.watch.units.filter((u) => u.win).map((u) => ({ label: u.label, p: Math.min(1, u.win[1] + 0.012) })) : [
    ['Strap', 0.17], ['Main plate', 0.17], ['Barrel', 0.24], ['Centre wheel', 0.28], ['Third wheel', 0.31], ['Fourth wheel', 0.34], ['Escape wheel', 0.37], ['Pallet fork', 0.4],
    ['Balance', 0.43], ['Barrel bridge', 0.47], ['Train bridge', 0.5], ['Balance cock', 0.52], ['Rotor', 0.58], ['Stem', 0.58], ['Caseback', 0.62], ['Dial', 0.72],
    ['Hour hand', 0.8], ['Minute hand', 0.84], ['Seconds hand', 0.88], ['Sapphire crystal', 0.94]].map(([label, p]) => ({ label, p }));
  parts = [...fixed, ...moving.sort((a, b) => a.p - b.p)].filter((x) => (seen.has(x.label) ? false : seen.add(x.label)));
  return parts;
}
let active = 0, shown = [];
function renderParts(q) {
  const ul = $('#parts');
  const n = q.trim().toLowerCase();
  // fuzzy-ish: every typed character in order
  const match = (s) => { let i = 0; for (const c of s.toLowerCase()) if (c === n[i]) i++; return i === n.length; };
  // substring matches first (in assembly order), then looser in-order matches
  const all = partList();
  shown = !n ? all : [...all.filter((x) => x.label.toLowerCase().includes(n)), ...all.filter((x) => !x.label.toLowerCase().includes(n) && match(x.label))];
  active = 0;
  ul.innerHTML = '';
  if (!shown.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No part by that name'; li.setAttribute('aria-disabled', 'true'); ul.append(li); $('#q').removeAttribute('aria-activedescendant'); return; }
  shown.forEach((x, k) => {
    const li = document.createElement('li');
    li.id = `part-${k}`; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(k === active));
    li.innerHTML = `<span></span><small>${x.note || `step ${stageOf(x.p) + 1}`}</small>`;
    li.firstChild.textContent = x.label;
    li.addEventListener('click', () => pick(k));
    ul.append(li);
  });
  $('#q').setAttribute('aria-activedescendant', 'part-0');
}
function move(d) {
  if (!shown.length) return;
  active = (active + d + shown.length) % shown.length;
  $$('#parts [role=option]').forEach((li, k) => li.setAttribute('aria-selected', String(k === active)));
  $('#q').setAttribute('aria-activedescendant', `part-${active}`);
  $(`#part-${active}`).scrollIntoView({ block: 'nearest' });
}
function pick(k) {
  const x = shown[k]; if (!x) return;
  closeSheet($('#search'));
  scrollToP(x.p);
  live.textContent = `${x.label}: ${x.note ? 'already on the case' : 'scrolling to the moment it is fitted'}.`;
}
$('#q').addEventListener('input', (e) => renderParts(e.target.value));
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); move(-active); }
  else if (e.key === 'Enter') { e.preventDefault(); pick(active); }
});

// ---------- bag ----------
let bag = store.get(KEY, 0) | 0;
function paintBag() {
  const c = $('#bag-count');
  c.hidden = bag < 1; c.textContent = String(bag);
  $('#bag-btn').setAttribute('aria-label', bag ? `Bag, ${bag} item${bag > 1 ? 's' : ''}` : 'Bag, empty');
}
function renderBag() {
  const body = $('#bag-body');
  if (!bag) {
    body.innerHTML = '<p class="bag-empty">Your bag is empty. Assemble the watch to add it.</p><div class="bag-actions"><button class="cta" type="button" data-to-final>See Calibre AH-01</button></div>';
  } else {
    body.innerHTML = `<div class="bag-line"><b>ATELIER H. Calibre AH-01</b><span>${bag} × € 18,400</span></div><div class="bag-line"><span>Total</span><b>€ ${(bag * 18400).toLocaleString('en-US')}</b></div>
      <div class="bag-actions"><button class="ghost" type="button" data-remove>Remove one</button><button class="cta" type="button" data-close>Continue</button></div>`;
  }
}
$('#bag-body').addEventListener('click', (e) => {
  if (e.target.closest('[data-to-final]')) { closeSheet($('#bag')); scrollToP(1); }
  if (e.target.closest('[data-remove]')) { bag = Math.max(0, bag - 1); store.set(KEY, bag); paintBag(); renderBag(); toast(bag ? 'Removed one from your bag' : 'Your bag is empty'); $('#bag-body').querySelector('button').focus(); }
});
addBtn.addEventListener('click', () => { bag = Math.min(9, bag + 1); store.set(KEY, bag); paintBag(); toast('Calibre AH-01 added to your bag'); });
let tt = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2200); }
paintBag();

// test / capture hooks
window.__dv65 = {
  ready,
  get p() { return P; },
  get stage() { return stage; },
  get noGL() { return noGL; },
  goto: (p, smooth = false) => scrollToP(p, smooth),
};

boot().catch((err) => {
  console.warn('DV65: WebGL stage failed, showing stills', err);
  noGL = true; canvas.hidden = true; $('#fallback').hidden = false; document.documentElement.classList.add('no-gl'); stageIdx = -1; paint(progressFromScroll()); booted = true; resolveReady();
});

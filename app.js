// PingSim Service Lab: front end.
// Physics runs in the C++ core (via labserver.py); this file does the UI, the 3D scene and the playback.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as backend from './backend.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ----------------------------------------------------------------------------- parameters

// hand: handedness of the server ('R' | 'L'); opp: handedness of the receiver. Both are display/convenience
// settings: the physics only sees the (mirrored if needed) racket parameters.
const DEFAULTS = {
  d: 1.45, lat: 0, h: 15, toss: 20, fall: 12, speed: 7, el: -50, az: 0, tilt: 30, yaw: 0, tmu: 0.25, rubber: 'inverted_soft', hand: 'R', opp: 'R',
  // racket held still in front of the ball (the receiver's racket, like a wall): on/off, position, face angle, covering
  wall: 0, wx: 0.9, wy: 0, wh: 19, wtilt: 0, wyaw: 0, wrubber: 'inverted_soft',
};
const WALL_KEYS = ['wall', 'wx', 'wy', 'wh', 'wtilt', 'wyaw', 'wrubber'];

// Mirror a setting left <-> right (a left-hander's gesture is the mirror image of a right-hander's).
const mirrorLateral = (p) => ({ ...p, lat: -p.lat, az: -p.az, yaw: -p.yaw });

// Where each control lives:
//  - `slot` + `panel`: in the overlay panel of one racket, on top of the 3D view (send = the racket that serves,
//    recv = the racket held still in front of the ball). `overlay` is the axis (x: along the table, y: lateral,
//    z: height) whose colour the slider takes and which is highlighted in the scene while it is used.
//  - `pad`: one of the two angles of an orientation ball, in the panel of its racket (see PADS).
//  - nothing of the above: sidebar (general settings).
const SLIDERS = [
  // --- racket that serves
  { panel: 'send', slot: 'send-pos', overlay: 'x', id: 'd', label: 'Recul (axe X)', unit: 'm', min: 1.38, max: 2.8, step: 0.01, dec: 2 },
  { panel: 'send', slot: 'send-pos', overlay: 'y', id: 'lat', label: 'Latéral (axe Y)', unit: 'm', min: -0.8, max: 0.8, step: 0.01, dec: 2 },
  { panel: 'send', slot: 'send-pos', overlay: 'z', id: 'h', label: 'Hauteur (axe Z)', unit: 'cm', min: 4, max: 50, step: 1, dec: 0 },
  { panel: 'send', slot: 'send-force', id: 'speed', label: 'Vitesse de la raquette', unit: 'm/s', min: 0, max: 25, step: 0.1, dec: 1 },
  { id: 'el', pad: 'gesture', label: 'Vertical', unit: '°', min: -80, max: 80, step: 1, dec: 0 },
  { id: 'az', pad: 'gesture', label: 'Latéral', unit: '°', min: -60, max: 60, step: 1, dec: 0 },
  { id: 'tilt', pad: 'face', label: 'Ouverture', unit: '°', min: -89, max: 89, step: 1, dec: 0 },
  { id: 'yaw', pad: 'face', label: 'Latéral', unit: '°', min: -60, max: 60, step: 1, dec: 0 },
  // --- general settings (sidebar)
  { group: 'Lancer', id: 'toss', label: 'Hauteur du lancer', unit: 'cm', min: 5, max: 50, step: 1, dec: 0, hint: '16 cm minimum exigés par le règlement' },
  { id: 'fall', label: 'Chute avant la frappe', unit: 'cm', min: 0, max: 60, step: 1, dec: 0, hint: 'Plus la balle tombe, plus elle arrive vite sur la raquette' },
  { group: 'Table', id: 'tmu', label: 'Frottement de la balle sur la table', unit: '', min: 0.1, max: 0.6, step: 0.01, dec: 2, hint: '0,25 par défaut. Plus il est élevé, plus le backspin freine la balle au rebond.' },
  // --- racket that receives: held still in front of the ball, like a wall
  { panel: 'recv', slot: 'recv-pos', overlay: 'x', id: 'wx', label: 'Distance (axe X)', unit: 'm', min: -0.3, max: 2.4, step: 0.01, dec: 2 },
  { panel: 'recv', slot: 'recv-pos', overlay: 'y', id: 'wy', label: 'Latéral (axe Y)', unit: 'm', min: -1.0, max: 1.0, step: 0.01, dec: 2 },
  { panel: 'recv', slot: 'recv-pos', overlay: 'z', id: 'wh', label: 'Hauteur (axe Z)', unit: 'cm', min: -10, max: 60, step: 1, dec: 0 },
  { id: 'wtilt', pad: 'wall', label: 'Inclinaison', unit: '°', min: -89, max: 89, step: 1, dec: 0 },
  { id: 'wyaw', pad: 'wall', label: 'Orientation', unit: '°', min: -60, max: 60, step: 1, dec: 0 },
];
const RUBBER_NOTES = {
  inverted_soft: "Beaucoup d'adhérence et de temps de contact : spin élevé.",
  inverted_hard: 'Éponge dure : balle plus rapide, contact plus bref.',
  short_pips: "Moins d'adhérence : spin plus faible, peu sensible au spin reçu.",
  long_pips: "Picots souples : crée peu de spin et laisse passer une bonne part de l'effet reçu.",
  anti_spin: "Surface glissante : presque aucun spin créé, balle « morte ».",
};
// Colours of a covering: [topsheet, sponge, pips style (0 smooth, 1 short pips, 2 long pips)]. The racket that serves
// is red and the racket that receives is blue, like the background of their panels: the two are told apart at a
// glance. The type of covering shows through the shade and the pimples.
const RUBBER_COLORS = {
  send: {
    inverted_soft: ['#d63a2f', '#f1c27d', 0], inverted_hard: ['#a11f1f', '#e6b46a', 0],
    short_pips: ['#e0553a', '#f1c27d', 1], long_pips: ['#7d1717', '#c9a15f', 2], anti_spin: ['#6b3a3a', '#b8b8b8', 0],
  },
  recv: {
    inverted_soft: ['#2f7bd6', '#f1c27d', 0], inverted_hard: ['#1f4f9c', '#e6b46a', 0],
    short_pips: ['#3f93e0', '#f1c27d', 1], long_pips: ['#17356b', '#c9a15f', 2], anti_spin: ['#3b4f6b', '#b8b8b8', 0],
  },
};

const PRESETS = [
  { name: 'Backspin court', p: {} },
  { name: 'Topspin', p: { speed: 12, el: 20, tilt: -50, az: 0 } },
  { name: 'Backspin + latéral', p: { speed: 8, el: -40, tilt: 30, az: -40 } },
  { name: 'Balle sans effet', p: { speed: 2, el: -15, tilt: 55, az: 0, fall: 30 } },
  // Face quasi horizontale, frappe loin derrière la table : la balle revient vers le filet (sensible aux réglages).
  { name: 'Backspin qui revient', p: { d: 2.7, h: 5, toss: 25, fall: 2, speed: 6.5, el: 18, az: 0, tilt: 89, yaw: 0 } },
  // Version plus plate du backspin qui revient (lisse dur) : sommet à 43 cm au lieu de 49 cm.
  { name: 'Backspin qui revient (plus plat)', p: { d: 1.43, h: 8, toss: 48, fall: 12, speed: 4.4, el: 6, az: 0, tilt: 88, yaw: 0, rubber: 'inverted_hard' } },
  // Table plus accrochante (frottement 0,40) : le retour exige moins de hauteur, sommet à 34 cm.
  { name: 'Backspin qui revient (table accrochante)', p: { d: 1.43, h: 15, toss: 30, fall: 14, speed: 5.8, el: 0, az: 0, tilt: 88, yaw: 0, tmu: 0.4, rubber: 'inverted_hard' } },
  // Pendulaire court : geste latéral descendant, face fermée tournée, effet latéral + backspin.
  // Écrit pour un serveur droitier : le 2e rebond part vers la droite du serveur, soit le revers d'un
  // adversaire droitier (le receveur fait face à -x : son revers est y < 0). Miroir automatique si « Gaucher ».
  { name: 'Pendulaire court', p: { d: 1.5, lat: -0.2, h: 14, toss: 30, fall: 10, speed: 11, el: -47, az: 24, tilt: 9, yaw: -43, rubber: 'inverted_soft' } },
  // Marteau (tomahawk) sur la diagonale coup droit : le serveur est sur sa droite (y < 0), la balle part vers sa gauche
  // et atterrit près du coin coup droit d'un adversaire droitier (y > 0), long, avec du topspin et beaucoup d'effet latéral.
  // Dans le modèle, la raquette balaie surtout latéralement (56°), face fermée : un geste très descendant ne crée presque
  // pas de spin ici. Préréglage défini par sa CIBLE : c'est la main de l'adversaire qui décide du côté (miroir si gaucher).
  { name: 'Marteau, diagonale coup droit', target: 'forehand', p: { d: 1.6, lat: -0.3, h: 12, toss: 30, fall: 8, speed: 13, el: -4, az: 56, tilt: -18, yaw: -16, rubber: 'inverted_soft' } },
];

let params = { ...DEFAULTS };
let lastResult = null;   // last server answer, kept to refresh the labels when the opponent's hand changes
let cfg = null;

// ----------------------------------------------------------------------------- UI building

const sliderEls = {};

function slot(name) { return document.querySelector(`[data-slot="${name}"]`); }

function setPanelOpen(panel, open) {
  panel.classList.toggle('closed', !open);
  const b = panel.querySelector('.ovp-toggle');
  b.textContent = open ? '−' : '+';
  b.setAttribute('aria-expanded', String(open));
  if (open) drawPads();   // balls that were folded away have no picture yet: draw them now that they have a size
}

function bindNumber(s, num) {
  num.addEventListener('input', () => { const v = parseFloat(num.value); if (Number.isFinite(v)) setParam(s.id, clamp(v, s.min, s.max), true); });
}

function buildControls() {
  const host = $('#sliders');
  let group = null;
  for (const s of SLIDERS) {
    if (s.pad) {
      // Orientation ball and its two numeric fields, in the panel of its racket.
      const key = s.pad, P = PADS[key];
      if (!document.getElementById('pad-' + key)) {
        const blk = document.createElement('div');
        blk.className = 'ov-pad';
        blk.innerHTML = `<div class="padtitle">${P.title}</div>
          <canvas class="pad" id="pad-${key}" tabindex="0" role="application" aria-label="${P.aria}" title="${P.help}"></canvas>
          <div class="padfields" id="padfields-${key}"></div>`;
        slot(P.slot).appendChild(blk);
        makePad(key, blk.querySelector('canvas'));
      }
      const f = document.createElement('div');
      f.className = 'padfield';
      f.innerHTML = `<label for="n-${s.id}">${s.label}</label><div class="val"><input type="number" id="n-${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${P.title} : ${s.label}"><span>${s.unit}</span></div>`;
      document.getElementById('padfields-' + key).appendChild(f);
      const num = f.querySelector('input');
      sliderEls[s.id] = { range: null, num, hint: null, def: '' };
      bindNumber(s, num);
      continue;
    }
    if (s.slot) {
      // Slider in the overlay panel of a racket, coloured like its axis in the scene.
      const row = document.createElement('div');
      row.className = 'ov-row' + (s.overlay ? ' axis-' + s.overlay : '');
      row.innerHTML = `
        <div class="ov-top"><label for="r-${s.id}"><i class="dot"></i>${s.label}</label>
          <div class="val"><input type="number" id="n-${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${s.label}"><span>${s.unit}</span></div></div>
        <input type="range" id="r-${s.id}" min="${s.min}" max="${s.max}" step="${s.step}">`;
      slot(s.slot).appendChild(row);
      const range = row.querySelector('input[type=range]'), num = row.querySelector('input[type=number]');
      sliderEls[s.id] = { range, num, hint: null, def: '' };
      range.addEventListener('input', () => setParam(s.id, parseFloat(range.value)));
      bindNumber(s, num);
      range.addEventListener('dblclick', () => setParam(s.id, DEFAULTS[s.id]));
      if (s.overlay) {
        // highlight the matching axis in the scene while the slider is hovered, focused or dragged
        const on = () => setActiveAxis(s.panel, s.overlay), off = () => setActiveAxis(null, null);
        row.addEventListener('pointerenter', on); row.addEventListener('pointerleave', off);
        range.addEventListener('focus', on); range.addEventListener('blur', off);
        range.addEventListener('pointerdown', on);
      }
      continue;
    }
    // general settings, in the sidebar
    if (s.group) {
      group = document.createElement('section');
      group.className = 'group';
      group.innerHTML = `<h2>${s.group}</h2>`;
      host.appendChild(group);
    }
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="top">
        <label for="r-${s.id}">${s.label}</label>
        <div class="val"><input type="number" id="n-${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${s.label}"><span>${s.unit}</span></div>
      </div>
      <input type="range" id="r-${s.id}" min="${s.min}" max="${s.max}" step="${s.step}">
      <div class="hint" id="h-${s.id}">${s.hint || ''}</div>`;
    group.appendChild(row);
    const range = row.querySelector('input[type=range]');
    const num = row.querySelector('input[type=number]');
    sliderEls[s.id] = { range, num, hint: row.querySelector('.hint'), def: s.hint || '' };
    range.addEventListener('input', () => setParam(s.id, parseFloat(range.value)));
    bindNumber(s, num);
    range.addEventListener('dblclick', () => setParam(s.id, DEFAULTS[s.id]));
  }
}
// Keep the wall racket at its chosen distance from the net and move it sideways and up/down so that
// it meets the ball there. The part of the flight before the racket is the same with or without it.
// If the ball never gets that far (a short service, a ball that comes back), the racket is brought to the farthest
// point of its flight instead. `activate` also switches the racket on (the button); `keepPreset` leaves the choice of
// service type displayed (automatic recentring after a new service).
function placeWallOnPath({ activate = true, keepPreset = false } = {}) {
  if (!data || !data.contact || !data.P) return;
  const tb2 = data.raw.t_bounce2 || 0;
  let xWant = params.wx - ballR - 0.02;                  // ball-centre x when it touches a racket centred at wx
  // The racket must catch the ball AFTER its second bounce. If that bounce is beyond the chosen distance, stand
  // just behind the bounce instead (the distance then changes).
  let first = -1;
  for (let i = 0; i < data.N; i++) if (data.T[i] > tb2) { first = i; break; }
  if (first < 0) return;
  let moveX = false;
  if (data.P[3 * first] > xWant) { xWant = data.P[3 * first] + 0.12; moveX = true; }
  let pick = -1, far = first, farX = -Infinity;
  for (let i = first; i < data.N; i++) {
    const x = data.P[3 * i];
    if (x > farX) { farX = x; far = i; }
    if (pick < 0 && x >= xWant) pick = i;
  }
  const reached = pick >= 0 && !moveX;
  if (pick < 0) { pick = far; moveX = true; }            // the ball never gets that far: go to the farthest point of its flight
  const lim = (id) => SLIDERS.find((s) => s.id === id);
  const fit = (id, v) => clamp(v, lim(id).min, lim(id).max);
  const x = data.P[3 * pick], y = -data.P[3 * pick + 2], z = data.P[3 * pick + 1];    // back to physics axes
  const next = { wy: fit('wy', Math.round(y * 100) / 100), wh: fit('wh', Math.round((z - cfg.table.height) * 100)) };
  if (!reached || moveX) next.wx = fit('wx', Math.round((x + ballR + 0.02) * 100) / 100);
  if (activate) next.wall = 1;
  setParams(next, { keepPreset });
}

function syncControls(skip) {
  for (const s of SLIDERS) {
    const e = sliderEls[s.id];
    const v = params[s.id];
    if (skip !== s.id) e.num.value = v.toFixed(s.dec);
    if (e.range) e.range.value = v;
  }
  drawPads();
  updateGizmo();
  poseWallFromParams();
  for (const b of document.querySelectorAll('#seg-hand button')) b.classList.toggle('on', b.dataset.v === params.hand);
  for (const b of document.querySelectorAll('#seg-opp button')) b.classList.toggle('on', b.dataset.v === params.opp);
  $('#rubber-select').value = params.rubber;
  $('#rubber-note').textContent = RUBBER_NOTES[params.rubber] || '';
  $('#wall-rubber-select').value = params.wrubber;
  $('#wall-rubber-note').textContent = RUBBER_NOTES[params.wrubber] || '';
  const wc = $('#chk-wall');
  if (wc) wc.checked = !!params.wall;
  $('#panel-recv').classList.toggle('off', !params.wall);
  const tossHint = sliderEls.toss.hint;
  const low = params.toss < 16;
  tossHint.textContent = low ? 'Trop bas : 16 cm minimum exigés par le règlement' : sliderEls.toss.def;
  tossHint.classList.toggle('warn', low);
}

function setParam(id, v, fromNumber) {
  params[id] = v;
  clearPresetChoice();
  syncControls(fromNumber ? id : null);
  requestCompute();
  saveHash();
}

// Set several parameters at once with a single recomputation.
function setParams(obj, { keepPreset = false } = {}) {
  Object.assign(params, obj);
  if (!keepPreset) clearPresetChoice();
  syncControls(null);
  requestCompute();
  saveHash();
}

// ----------------------------------------------------------------------------- orientation balls
// A direction in the forward hemisphere is described by two angles, v (up/down) and h (left/right):
//   d = (cos v cos h, cos v sin h, sin v)
// The racket face normal (tilt, yaw) and the stroke direction (elevation, azimuth) use the same
// parametrisation, so one widget serves both. The ball is drawn as seen from behind the server:
// screen x = -d_y (right), screen y = d_z (up). Parallels (constant v) are straight chords and
// meridians (constant h) are arcs.
const PAD_MARGIN = 16;
const D2R = Math.PI / 180;
const padProject = (v, h) => [-Math.cos(v * D2R) * Math.sin(h * D2R), Math.sin(v * D2R)];

const PADS = {
  face: {
    slot: 'send-pads', v: 'tilt', h: 'yaw', vmax: 89, hmax: 60, color: '#ffd34d', style: 'face', title: 'Face',
    aria: 'Orientation de la face : faites glisser le point, ou utilisez les flèches du clavier',
    help: 'Faites glisser le point : vers le haut la face s’ouvre, sur les côtés elle tourne. Double-clic : remettre à zéro.',
  },
  wall: {
    slot: 'recv-pads', v: 'wtilt', h: 'wyaw', vmax: 89, hmax: 60, color: '#4da3ff', style: 'face', title: 'Face',
    aria: 'Angle de la raquette adverse : faites glisser le point, ou utilisez les flèches du clavier',
    help: 'Direction vers laquelle regarde la face, vue de derrière le serveur. Au centre : face au serveur, verticale ; vers le haut : face vers le plafond ; sur les côtés : tournée à gauche ou à droite. Double-clic : remettre à zéro.',
  },
  gesture: {
    slot: 'send-pads', v: 'el', h: 'az', vmax: 80, hmax: 60, color: '#ff9f43', style: 'arrow', title: 'Geste',
    aria: 'Direction du geste : faites glisser le point, ou utilisez les flèches du clavier',
    help: 'Faites glisser le point : vers le haut le geste monte, vers le bas il descend, sur les côtés il part à gauche ou à droite. Double-clic : remettre à zéro.',
  },
};
const pads = [];

function makePad(key, canvasEl) {
  const P = PADS[key];
  const geom = () => {
    const r = canvasEl.getBoundingClientRect();
    return { r, w: r.width, h: r.height, cx: r.width / 2, cy: r.height / 2, R: Math.min(r.width, r.height) / 2 - PAD_MARGIN };
  };

  function draw() {
    const { g, w, h } = setupCanvas(canvasEl);
    const { cx, cy, R } = geom();
    if (!(R > 4)) return;   // folded panel: the canvas has no size yet (the ResizeObserver redraws it when shown)
    const X = (sx) => cx + sx * R, Y = (sy) => cy - sy * R;
    g.clearRect(0, 0, w, h);

    // sphere body
    const grad = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    grad.addColorStop(0, '#34475f'); grad.addColorStop(0.7, '#1a2533'); grad.addColorStop(1, '#101822');
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a4a5f'; g.lineWidth = 1.5; g.stroke();

    // reachable region (v within +-P.vmax, h within +-P.hmax)
    g.beginPath();
    for (let v = -P.vmax; v <= P.vmax; v += 4) { const [sx, sy] = padProject(v, P.hmax); v === -P.vmax ? g.moveTo(X(sx), Y(sy)) : g.lineTo(X(sx), Y(sy)); }
    for (let v = P.vmax; v >= -P.vmax; v -= 4) { const [sx, sy] = padProject(v, -P.hmax); g.lineTo(X(sx), Y(sy)); }
    g.closePath();
    g.fillStyle = 'rgba(76,194,255,.07)'; g.fill();
    g.strokeStyle = 'rgba(76,194,255,.45)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]);

    // grid: parallels and meridians
    g.lineWidth = 1;
    for (const v of [-60, -40, -20, 0, 20, 40, 60]) {
      const [a, y] = padProject(v, P.hmax), [b] = padProject(v, -P.hmax);
      g.strokeStyle = v === 0 ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.11)';
      g.beginPath(); g.moveTo(X(a), Y(y)); g.lineTo(X(b), Y(y)); g.stroke();
    }
    for (const hh of [-60, -40, -20, 0, 20, 40, 60]) {
      g.strokeStyle = hh === 0 ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.11)';
      g.beginPath();
      for (let v = -P.vmax; v <= P.vmax; v += 4) { const [sx, sy] = padProject(v, hh); v === -P.vmax ? g.moveTo(X(sx), Y(sy)) : g.lineTo(X(sx), Y(sy)); }
      g.stroke();
    }

    // edge labels
    g.fillStyle = '#93a1b3'; g.font = '10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('haut', cx, cy - R - 8); g.fillText('bas', cx, cy + R + 8);
    g.textAlign = 'left'; g.fillText('G', 2, cy); g.textAlign = 'right'; g.fillText('D', w - 2, cy);

    // current value
    const vv = params[P.v], hh = params[P.h];
    const [px, py] = padProject(vv, hh);
    const x = X(px), y = Y(py);
    g.strokeStyle = P.color; g.globalAlpha = 0.6; g.lineWidth = P.style === 'arrow' ? 2.5 : 1.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); g.globalAlpha = 1;
    g.fillStyle = P.color; g.strokeStyle = '#10151c'; g.lineWidth = 2;
    if (P.style === 'arrow') {
      // arrow head pointing along the stroke direction
      const ang = Math.atan2(y - cy, x - cx), c = Math.cos(ang), s = Math.sin(ang);
      g.beginPath();
      g.moveTo(x + 4 * c, y + 4 * s);
      g.lineTo(x - 10 * c + 7 * -s, y - 10 * s + 7 * c);
      g.lineTo(x - 10 * c - 7 * -s, y - 10 * s - 7 * c);
      g.closePath(); g.fill(); g.stroke();
    } else {
      // a small racket face seen obliquely (foreshortened by the angle to the viewer)
      const facing = Math.cos(vv * D2R) * Math.cos(hh * D2R);
      g.save(); g.translate(x, y); g.rotate(Math.atan2(-py, px) + Math.PI / 2);
      g.beginPath(); g.ellipse(0, 0, 9 * Math.max(0.35, facing), 9, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.restore();
      g.fillStyle = '#10151c'; g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill();
    }
  }

  function fromEvent(e) {
    const { r, cx, cy, R } = geom();
    let sx = (e.clientX - r.left - cx) / R, sy = -(e.clientY - r.top - cy) / R;
    const m = Math.hypot(sx, sy);
    if (m > 0.999) { sx = (sx / m) * 0.999; sy = (sy / m) * 0.999; }
    const dz = sy, dy = -sx, dx = Math.sqrt(Math.max(1e-6, 1 - sx * sx - sy * sy));
    const v = clamp(Math.round((Math.asin(dz) * 180) / Math.PI), -P.vmax, P.vmax);
    const h = clamp(Math.round((Math.atan2(dy, dx) * 180) / Math.PI), -P.hmax, P.hmax);
    if (v !== params[P.v] || h !== params[P.h]) setParams({ [P.v]: v, [P.h]: h });
  }

  let dragging = false;
  canvasEl.addEventListener('pointerdown', (e) => { dragging = true; canvasEl.setPointerCapture(e.pointerId); canvasEl.style.cursor = 'grabbing'; fromEvent(e); });
  canvasEl.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  const end = (e) => { dragging = false; canvasEl.style.cursor = 'grab'; try { canvasEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ } };
  canvasEl.addEventListener('pointerup', end);
  canvasEl.addEventListener('pointercancel', end);
  canvasEl.addEventListener('dblclick', () => setParams({ [P.v]: DEFAULTS[P.v], [P.h]: DEFAULTS[P.h] }));
  canvasEl.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 5 : 1;
    let v = params[P.v], h = params[P.h];
    if (e.key === 'ArrowUp') v += step; else if (e.key === 'ArrowDown') v -= step;
    else if (e.key === 'ArrowLeft') h += step; else if (e.key === 'ArrowRight') h -= step; else return;
    e.preventDefault();
    setParams({ [P.v]: clamp(v, -P.vmax, P.vmax), [P.h]: clamp(h, -P.hmax, P.hmax) });
  });
  new ResizeObserver(draw).observe(canvasEl);
  pads.push({ key, draw });
}
function drawPads() { for (const p of pads) p.draw(); }

// Covering of each racket: one drop-down list per panel, with a short description of the chosen covering below it.
function buildRubberChips() {
  const fill = (selSel, key) => {
    const sel = $(selSel);
    sel.innerHTML = cfg.rubbers.map((r) => `<option value="${r.key}">${r.label}</option>`).join('');
    sel.addEventListener('change', () => { params[key] = sel.value; syncControls(); requestCompute(); saveHash(); });
  };
  fill('#rubber-select', 'rubber');
  fill('#wall-rubber-select', 'wrubber');
}

// Ready-made services: a drop-down list. It shows the chosen service until a setting is changed by hand.
function buildPresets() {
  const sel = $('#preset-select');
  sel.innerHTML = '<option value="">Choisir un service type…</option>' +
    PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
  sel.addEventListener('change', () => { if (sel.value !== '') applyPreset(PRESETS[Number(sel.value)]); });
}
function applyPreset(pr) {
  // Presets are written for a right-handed server and a right-handed receiver. A preset defined by its stroke is
  // mirrored for a left-handed server; one defined by its TARGET (`target`: the forehand or backhand of the
  // receiver) is mirrored for a left-handed receiver, whose forehand is on the other side of the table.
  // (the wall racket settings are kept: they describe the receiver, not the service)
  const keepWall = Object.fromEntries(WALL_KEYS.map((k) => [k, params[k]]));
  let next = { ...DEFAULTS, ...keepWall, rubber: params.rubber, hand: params.hand, opp: params.opp, ...pr.p };
  if (pr.target ? params.opp === 'L' : params.hand === 'L') next = mirrorLateral(next);
  params = next;
  recenterWall = true;   // once the new flight is known, put the receiving racket back on it (see applyResult)
  syncControls(); requestCompute(); saveHash(); replay();
}
let recenterWall = false;
function clearPresetChoice() { const s = $('#preset-select'); if (s) s.value = ''; }

function saveHash() {
  clearTimeout(saveHash.t);
  saveHash.t = setTimeout(() => {
    const q = new URLSearchParams();
    for (const k of Object.keys(DEFAULTS)) q.set(k, String(params[k]));
    try { history.replaceState(null, '', '#' + q.toString()); } catch (e) { /* ignore */ }
  }, 150);
}

function loadHash() {
  if (!location.hash.length) return;
  const q = new URLSearchParams(location.hash.slice(1));
  for (const s of SLIDERS) {
    if (q.has(s.id)) { const v = parseFloat(q.get(s.id)); if (Number.isFinite(v)) params[s.id] = clamp(v, s.min, s.max); }
  }
  if (q.has('rubber') && cfg.rubbers.some((r) => r.key === q.get('rubber'))) params.rubber = q.get('rubber');
  if (q.has('wall')) params.wall = q.get('wall') === '1' ? 1 : 0;
  if (q.has('wrubber') && cfg.rubbers.some((r) => r.key === q.get('wrubber'))) params.wrubber = q.get('wrubber');
  if (q.get('hand') === 'L' || q.get('hand') === 'R') params.hand = q.get('hand');
  if (q.get('opp') === 'L' || q.get('opp') === 'R') params.opp = q.get('opp');
}

// ----------------------------------------------------------------------------- server round trips

let inflight = false, dirty = false;

function queryOf(p) {
  const q = new URLSearchParams({
    x: (-p.d).toFixed(4), y: p.lat.toFixed(4), z: (cfg.table.height + p.h / 100).toFixed(4),
    toss: (p.toss / 100).toFixed(4), fall: (p.fall / 100).toFixed(4), speed: p.speed.toFixed(3),
    el: p.el.toFixed(3), az: p.az.toFixed(3), tilt: p.tilt.toFixed(3), yaw: p.yaw.toFixed(3), tmu: p.tmu.toFixed(3), rubber: p.rubber,
    wall: String(p.wall ? 1 : 0), wx: p.wx.toFixed(3), wy: p.wy.toFixed(3), wz: (cfg.table.height + p.wh / 100).toFixed(4),
    wtilt: p.wtilt.toFixed(3), wyaw: p.wyaw.toFixed(3), wrubber: p.wrubber,
  });
  return q.toString();
}

function requestCompute() {
  dirty = true;
  if (!inflight) pump();
}

// Only the latest parameters are ever computed: while a request is in flight, new input just marks the
// state dirty, so dragging a slider never builds a queue.
async function pump() {
  inflight = true;
  while (dirty) {
    dirty = false;
    try {
      const t0 = performance.now();
      const j = await backend.serve(queryOf(params));
      const rtt = performance.now() - t0;
      if (j.error) showError(j.error); else { showError(null); applyResult(j, rtt); }
    } catch (e) {
      showError('Calcul impossible : ' + e);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  inflight = false;
}

function showError(msg) {
  const el = $('#status');
  if (msg) { el.className = 'badge ko'; el.textContent = msg; }
}

function b64ToF32(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

// ----------------------------------------------------------------------------- scene

const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1218);
scene.fog = new THREE.Fog(0x0d1218, 9, 22);

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 60);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.4;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.495;

// Physics frame (x along table, y across, z up) -> three.js frame (X = x, Y = z, Z = -y); a proper rotation.
const P3 = (x, y, z) => new THREE.Vector3(x, z, -y);

const CAMS = {
  three: { pos: [-3.3, 1.8, 2.4], target: [-0.9, 0.8, 0] },
  server: { pos: [-4.2, 1.6, 0.0], target: [0.2, 0.75, 0] },
  top: { pos: [0.1, 4.4, 0.6], target: [0.1, 0.7, 0] },
  side: { pos: [0.2, 1.0, 4.0], target: [0.2, 0.85, 0] },
  receiver: { pos: [3.3, 1.45, 0.0], target: [-0.6, 0.75, 0] },
};
let camAnim = null;
function goCam(name, instant) {
  const c = CAMS[name];
  const to = new THREE.Vector3(...c.pos), tt = new THREE.Vector3(...c.target);
  $('#cam-select').value = name;
  if (instant) { camera.position.copy(to); controls.target.copy(tt); controls.update(); return; }
  camAnim = { t: 0, dur: 0.7, fp: camera.position.clone(), ft: controls.target.clone(), tp: to, tt };
}

function buildEnvironment() {
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a2230, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-2.5, 5, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -3; sun.shadow.camera.right = 3; sun.shadow.camera.top = 3; sun.shadow.camera.bottom = -3;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 14;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.95 }));
  floor.receiveShadow = true;
  scene.add(floor);

  const { length: L, width: W, height: H, net_height: NH } = cfg.table;
  const table = new THREE.Group();
  const topMat = new THREE.MeshStandardMaterial({ color: 0x1b4f9a, roughness: 0.55, metalness: 0.0 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(L, 0.03, W), topMat);
  top.position.set(0, H - 0.015, 0);
  top.receiveShadow = true; top.castShadow = true;
  table.add(top);
  // white lines
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4f6fa, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const addLine = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), lineMat); m.position.set(x, H + 0.0006, z); table.add(m); };
  addLine(L, 0.02, 0, W / 2 - 0.01); addLine(L, 0.02, 0, -W / 2 + 0.01);
  addLine(0.02, W, L / 2 - 0.01, 0); addLine(0.02, W, -L / 2 + 0.01, 0);
  addLine(L - 0.04, 0.003, 0, 0);
  // legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2c333d, roughness: 0.8 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.03, 0.05), legMat);
    leg.position.set(sx * (L / 2 - 0.15), (H - 0.03) / 2, sz * (W / 2 - 0.1));
    leg.castShadow = true;
    table.add(leg);
  }
  // net
  const ov = 0.1525;
  const netTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32;
    const g = c.getContext('2d'); g.clearRect(0, 0, 128, 32); g.strokeStyle = 'rgba(235,240,250,.85)'; g.lineWidth = 1.2;
    for (let i = 0; i <= 128; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 32); g.stroke(); }
    for (let j = 0; j <= 32; j += 4) { g.beginPath(); g.moveTo(0, j); g.lineTo(128, j); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const net = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * ov, NH).rotateY(Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, opacity: 0.9, depthWrite: false }));
  net.position.set(0, H + NH / 2, 0);
  table.add(net);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, W + 2 * ov), new THREE.MeshStandardMaterial({ color: 0xf2f4f8 }));
  band.position.set(0, H + NH, 0);
  table.add(band);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, NH + 0.02, 12), new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.6, roughness: 0.4 }));
    post.position.set(0, H + (NH + 0.02) / 2 - 0.01, s * (W / 2 + ov));
    table.add(post);
  }
  scene.add(table);
}

// --- ball

function makeBallTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f6f2e8'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#f08a24';
  for (let i = 0; i < 4; i++) g.fillRect(i * 128 - 5, 0, 10, 256);   // meridians
  g.fillRect(0, 123, 512, 10);                                        // equator
  g.fillStyle = '#222'; g.beginPath(); g.arc(64, 128, 26, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f6f2e8'; g.font = 'bold 24px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('★', 64, 130);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
let ballR = 0.02;
const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.35 }));
ball.castShadow = true;
scene.add(ball);

const spinArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.1, 0xffd34d, 0.025, 0.014);
scene.add(spinArrow);

// --- trajectory tubes (in-place updated, unlit, per-vertex colors)

function makeTube(maxPts, color, opacity) {
  const radial = 6;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(maxPts * radial * 3), col = new Float32Array(maxPts * radial * 3);
  const idx = [];
  for (let i = 0; i < maxPts - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + (j + 1) % radial, c = a + radial, d = b + radial;
    idx.push(a, b, c, b, d, c);
  }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: !color, color: color || 0xffffff, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  geo.setDrawRange(0, 0);
  return { mesh, geo, radial, maxPts, count: 0 };
}
const _N = new THREE.Vector3(), _B = new THREE.Vector3(), _T = new THREE.Vector3(), _R = new THREE.Vector3();
function updateTube(tube, pts, colors, n, radius) {
  const { geo, radial } = tube;
  const pos = geo.attributes.position.array, col = geo.attributes.color.array;
  n = Math.min(n, tube.maxPts);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    _T.set(pts[3 * i1] - pts[3 * i0], pts[3 * i1 + 1] - pts[3 * i0 + 1], pts[3 * i1 + 2] - pts[3 * i0 + 2]).normalize();
    _R.set(0, 1, 0);
    if (Math.abs(_T.dot(_R)) > 0.95) _R.set(1, 0, 0);
    _N.crossVectors(_T, _R).normalize();
    _B.crossVectors(_T, _N);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2, ca = Math.cos(a) * radius, sa = Math.sin(a) * radius;
      const o = (i * radial + j) * 3;
      pos[o] = pts[3 * i] + _N.x * ca + _B.x * sa;
      pos[o + 1] = pts[3 * i + 1] + _N.y * ca + _B.y * sa;
      pos[o + 2] = pts[3 * i + 2] + _N.z * ca + _B.z * sa;
      if (colors) { col[o] = colors[3 * i]; col[o + 1] = colors[3 * i + 1]; col[o + 2] = colors[3 * i + 2]; }
    }
  }
  geo.attributes.position.needsUpdate = true;
  if (colors) geo.attributes.color.needsUpdate = true;
  tube.count = n;
  tube.geo.setDrawRange(0, Math.max(0, n - 1) * radial * 6);
}
function setTubeProgress(tube, segments) {
  tube.geo.setDrawRange(0, clamp(segments, 0, Math.max(0, tube.count - 1)) * tube.radial * 6);
}
const tubeFull = makeTube(400, null, 0.35);
const tubeDone = makeTube(400, null, 1);
const tubeGhost = makeTube(400, 0xdfe6f0, 0.45);
scene.add(tubeFull.mesh, tubeDone.mesh, tubeGhost.mesh);
let ghostOn = false;

function speedColor(t) { // 0..1 -> blue, cyan, yellow, red
  const stops = [[0.15, 0.4, 1], [0.1, 0.85, 0.9], [1, 0.85, 0.2], [1, 0.3, 0.2]];
  const f = clamp(t, 0, 1) * 3, i = Math.min(2, Math.floor(f)), u = f - i;
  return stops[i].map((a, k) => a + (stops[i + 1][k] - a) * u);
}

// --- markers

const markers = [];
for (const color of [0xffa94d, 0xff5d5d, 0xb388ff]) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
  m.visible = false; m.renderOrder = 5;
  scene.add(m); markers.push(m);
}
const netMarker = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.024, 24).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4da3ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
netMarker.visible = false; scene.add(netMarker);
const flash = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.03, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
flash.visible = false; scene.add(flash);

// --- axis gizmos: three rods through the position of a racket, coloured like the sliders of its panel
const AXIS_COLORS = { x: 0xff5d5d, y: 0x46d39a, z: 0x6aa6ff };
function makeGizmo(markColor) {
  const g = { rods: {}, dot: null, foot: null };
  for (const k of ['x', 'y', 'z']) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), new THREE.MeshBasicMaterial({ color: AXIS_COLORS[k], transparent: true, opacity: 0.55, depthWrite: false }));
    m.renderOrder = 4;
    scene.add(m);
    g.rods[k] = m;
  }
  g.dot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), new THREE.MeshBasicMaterial({ color: markColor, transparent: true, opacity: 0.9, depthWrite: false }));
  g.foot = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.03, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: markColor, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  g.foot.renderOrder = 4;
  scene.add(g.dot, g.foot);
  return g;
}
const gizmo = makeGizmo(0xffffff);       // where the serving racket hits the ball
const gizmoRecv = makeGizmo(0x4da3ff);   // where the receiving racket is held
let activePanel = null, activeAxis = null;
function setActiveAxis(panel, axis) { activePanel = panel; activeAxis = axis; updateGizmo(); }

function placeGizmo(g, C, H, zPhys, active, strength) {
  g.dot.position.copy(C);
  g.foot.position.set(C.x, H + 0.003, C.z);
  const bottom = Math.min(H, zPhys), top = Math.max(H, zPhys) + 0.3;
  const spec = {
    x: { len: 1.4, pos: C.clone(), rot: [0, 0, Math.PI / 2] },                                             // along the table
    y: { len: 1.2, pos: C.clone(), rot: [Math.PI / 2, 0, 0] },                                             // across the table
    z: { len: top - bottom, pos: new THREE.Vector3(C.x, (bottom + top) / 2, C.z), rot: [0, 0, 0] },        // vertical
  };
  for (const k of ['x', 'y', 'z']) {
    const rod = g.rods[k], s = spec[k];
    const on = active === k, dim = active && !on;
    const r = on ? 0.007 : 0.0025;
    rod.position.copy(s.pos);
    rod.rotation.set(...s.rot);
    rod.scale.set(r, s.len, r);
    rod.material.opacity = (on ? 1 : dim ? 0.2 : 0.5) * strength;
  }
  g.dot.material.opacity = 0.9 * strength; g.foot.material.opacity = 0.8 * strength;
}
// Follow the sliders instantly (no server round trip): both positions are plain functions of the parameters.
function updateGizmo() {
  if (!cfg) return;
  const H = cfg.table.height;
  const zs = H + params.h / 100;
  placeGizmo(gizmo, P3(-params.d, params.lat, zs), H, zs, activePanel === 'send' ? activeAxis : null, 1);
  const zw = H + params.wh / 100;
  placeGizmo(gizmoRecv, P3(params.wx, params.wy, zw), H, zw, activePanel === 'recv' ? activeAxis : null, params.wall ? 1 : 0.45);
}

// --- racket

const racket = new THREE.Group();
scene.add(racket);
const velArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.3, 0xffb454, 0.05, 0.03);
const normArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.12, 0x6fd8ff, 0.03, 0.02);
scene.add(velArrow, normArrow);
let racketKey = null;

function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
  g.clear();
}
function buildRacketInto(group, key, role = 'send') {
  disposeGroup(group);
  const palette = RUBBER_COLORS[role] || RUBBER_COLORS.send;
  const [topColor, spongeColor, pips] = palette[key] || palette.inverted_soft;
  const RX = 0.075, RY = 0.08;
  const wood = new THREE.MeshStandardMaterial({ color: 0xc9955c, roughness: 0.7 });
  const shape = new THREE.Shape(); shape.absellipse(0, 0, RX, RY, 0, Math.PI * 2, false, 0);
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false }).translate(0, 0, -0.0088), wood);
  blade.castShadow = true; group.add(blade);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.02), wood);
  handle.position.set(0, -RY - 0.045, -0.0088 + 0.003); handle.castShadow = true; group.add(handle);
  const disc = (h, z, color, sx = 0.995, rough = 0.5) => {
    const g = new THREE.CylinderGeometry(1, 1, h, 56).rotateX(Math.PI / 2).scale(RX * sx, RY * sx, 1);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: rough }));
    m.position.z = z; m.castShadow = true; group.add(m);
  };
  const spongeH = pips === 2 ? 0.0012 : 0.002;
  disc(0.0008, -0.0004, topColor, 0.995, pips ? 0.9 : 0.3);
  disc(spongeH, -0.0008 - spongeH / 2, spongeColor, 0.99, 0.9);
  disc(0.0018, -0.0088 - 0.0009, 0x1a1a1a, 0.995, 0.6);  // back covering
  if (pips) {
    const r = pips === 2 ? 0.0005 : 0.0009, h = pips === 2 ? 0.0035 : 0.0012, step = pips === 2 ? 0.0032 : 0.0030;
    const geo = new THREE.CylinderGeometry(r, r, h, 8).rotateX(Math.PI / 2).translate(0, 0, h / 2);
    const pts = [];
    for (let y = -RY + 0.004; y < RY - 0.004; y += step) for (let x = -RX + 0.004; x < RX - 0.004; x += step) {
      if ((x * x) / ((RX - 0.003) ** 2) + (y * y) / ((RY - 0.003) ** 2) < 1) pts.push([x, y]);
    }
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.8 }), pts.length);
    const mtx = new THREE.Matrix4();
    pts.forEach((p, i) => { mtx.makeTranslation(p[0], p[1], 0); im.setMatrixAt(i, mtx); });
    im.castShadow = true; group.add(im);
  }
}
function buildRacket(key) { buildRacketInto(racket, key, 'send'); racketKey = key; }
// Orient a racket group: its face normal is n3; `rollDeg` turns it about that normal (visual only).
// The blade is built with the handle pointing "down" (-y) and local +x = the viewer's left when the face
// looks away from the viewer; a positive roll therefore swings the handle towards the player's left.
function orientGroup(group, n3, rollDeg = 0) {
  const z = n3.clone().normalize();
  let y = new THREE.Vector3(0, 1, 0).addScaledVector(z, -z.y);
  if (y.lengthSq() < 1e-4) y = new THREE.Vector3(1, 0, 0).addScaledVector(z, -z.x);
  y.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  if (rollDeg) group.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollDeg * Math.PI / 180));
}
// A racket is held tilted, handle at the bottom left for a right-hander (bottom right for a left-hander), seen from
// the player's own point of view. Only the picture changes: the contact point stays at the centre of the blade.
const RACKET_ROLL = 35;
const rollFor = (hand) => (hand === 'L' ? -RACKET_ROLL : RACKET_ROLL);
const orientRacket = (n3) => orientGroup(racket, n3, rollFor(params.hand));      // the server's racket: the server's hand

// The receiver's racket, held still in front of the ball like a wall.
const wallRacket = new THREE.Group();
wallRacket.visible = false;
scene.add(wallRacket);
let wallKey = null, wallOpacity = 1;

function setGroupOpacity(g, a) {
  g.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.transparent = a < 1; m.opacity = a; m.depthWrite = a >= 1; }
  });
}
// Pose the wall racket from the current settings. It is always shown, as a faint ghost while it is switched
// off, so that one sees where it would stand; it becomes solid once the box is ticked.
function poseWallFromParams() {
  if (!cfg) return;
  if (wallKey !== params.wrubber) { buildRacketInto(wallRacket, params.wrubber, 'recv'); wallKey = params.wrubber; wallOpacity = 1; }
  const a = params.wtilt * D2R, b = params.wyaw * D2R;
  wallRacket.position.copy(P3(params.wx, params.wy, cfg.table.height + params.wh / 100));
  orientGroup(wallRacket, P3(-Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)), rollFor(params.opp));  // the receiver's hand
  wallRacket.visible = true;
  const target = params.wall ? 1 : 0.28;
  if (target !== wallOpacity) { setGroupOpacity(wallRacket, target); wallOpacity = target; }
}
const wallFlash = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.03, 32), new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
wallFlash.visible = false;
scene.add(wallFlash);

// ----------------------------------------------------------------------------- result handling

let data = null;           // decoded current result
let ghostData = null;

function applyResult(j, rtt) {
  const d = { raw: j, contact: j.contact, legal: j.legal };
  ballR = cfg.ball_radius;
  ball.scale.setScalar(ballR);

  const impact = P3(...j.racket.pos);
  d.impact = impact;
  d.vIn = j.ball_velocity_in[2];
  const n = P3(...j.racket.normal), v = P3(...j.racket.velocity);
  d.n = n; d.v = v;
  d.contactPoint = impact.clone().addScaledVector(n, -ballR);

  if (j.contact) {
    const f = b64ToF32(j.traj_b64), N = j.traj_n;
    d.N = N;
    d.T = new Float32Array(N); d.P = new Float32Array(3 * N); d.W = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) {
      const o = 7 * i;
      d.T[i] = f[o];
      d.P[3 * i] = f[o + 1]; d.P[3 * i + 1] = f[o + 3]; d.P[3 * i + 2] = -f[o + 2];     // x, z, -y
      d.W[3 * i] = f[o + 4]; d.W[3 * i + 1] = f[o + 6]; d.W[3 * i + 2] = -f[o + 5];
    }
    // orientation of the ball by integrating the angular velocity (world frame)
    d.Q = new Array(N);
    d.Q[0] = new THREE.Quaternion();
    const dq = new THREE.Quaternion(), ax = new THREE.Vector3();
    for (let i = 0; i < N - 1; i++) {
      ax.set(d.W[3 * i], d.W[3 * i + 1], d.W[3 * i + 2]);
      const w = ax.length(), dt = d.T[i + 1] - d.T[i];
      if (w > 1e-9) dq.setFromAxisAngle(ax.multiplyScalar(1 / w), w * dt); else dq.identity();
      d.Q[i + 1] = dq.clone().multiply(d.Q[i]);
    }
    // colors by speed
    const col = new Float32Array(3 * N);
    const sp = new Float32Array(N);
    let smax = 1e-6;
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      const dt = Math.max(1e-6, d.T[b] - d.T[a]);
      sp[i] = Math.hypot(d.P[3 * b] - d.P[3 * a], d.P[3 * b + 1] - d.P[3 * a + 1], d.P[3 * b + 2] - d.P[3 * a + 2]) / dt;
      smax = Math.max(smax, sp[i]);
    }
    for (let i = 0; i < N; i++) { const c = speedColor(sp[i] / smax); col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2]; }
    d.col = col;
    updateTube(tubeFull, d.P, col, N, 0.0032);
    updateTube(tubeDone, d.P, col, N, 0.0048);
    d.tEnd = d.T[N - 1] + 0.2;
    // markers follow the displayed flight (it may continue after the wall racket)
    d.bounces = (j.path_bounces || j.bounces).map((b) => P3(b[0], b[1], b[2] - ballR));
    d.netClearance = j.net_clearance;
    const ev = j.events.find((e) => e.type === 'net_pass');
    d.netPass = ev ? P3(...ev.pos) : null;
  } else {
    d.N = 0; d.tEnd = 0.6; d.bounces = []; d.netPass = null;
    tubeFull.geo.setDrawRange(0, 0); tubeDone.geo.setDrawRange(0, 0);
  }

  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    m.visible = !!d.bounces[i];
    if (d.bounces[i]) m.position.copy(d.bounces[i]).add(new THREE.Vector3(0, 0.002, 0));
  }
  if (d.netPass) { netMarker.visible = true; netMarker.position.copy(d.netPass); } else netMarker.visible = false;

  if (racketKey !== j.rubber) buildRacket(j.rubber);
  orientRacket(n);
  const sp = j.racket.speed;
  velArrow.visible = sp > 0.05;
  if (velArrow.visible) { velArrow.setDirection(v.clone().normalize()); velArrow.setLength(clamp(0.035 * sp, 0.08, 0.9), 0.05, 0.03); }
  normArrow.setDirection(n); normArrow.setLength(0.12, 0.03, 0.02);

  // wall racket
  const W = j.wall;
  if (W) {
    if (wallKey !== W.rubber) { buildRacketInto(wallRacket, W.rubber, 'recv'); wallKey = W.rubber; wallOpacity = 1; }
    wallRacket.position.copy(P3(...W.pos));
    orientGroup(wallRacket, P3(...W.normal), rollFor(params.opp));
    wallRacket.visible = true;
    if (wallOpacity !== 1) { setGroupOpacity(wallRacket, 1); wallOpacity = 1; }
    d.wall = { hit: W.hit, t: W.t, pos: W.hit_pos ? P3(...W.hit_pos) : null, n: P3(...W.normal) };
  } else { poseWallFromParams(); d.wall = null; }

  data = d;
  if (recenterWall) {
    // A new service type was chosen: the receiving racket follows the new flight (same distance from the net,
    // height and side set on the ball). It keeps its angle and covering, and stays on or off as it was.
    recenterWall = false;
    placeWallOnPath({ activate: false, keepPreset: true });
  }
  updateHud(j, rtt);
  drawMinimap(d);
  drawContact(j);
}

// ----------------------------------------------------------------------------- HUD

const fmt = (v, n = 1) => (Math.abs(v) < 0.5 * Math.pow(10, -n) ? 0 : v).toFixed(n);

function lateralText(y) {
  const cm = Math.abs(y) * 100;
  if (cm < 2) return 'sur l’axe';
  return `${cm.toFixed(0)} cm à ${y > 0 ? 'gauche' : 'droite'}`;
}

function updateHud(j, rtt) {
  lastResult = { j, rtt };
  const st = $('#status');
  st.className = 'badge ' + (j.legal ? 'ok' : 'ko');
  st.textContent = (j.legal ? '✔ ' : '✖ ') + j.fault_label;

  const L = j.launch, I = j.impact;
  const rows = [];
  if (j.contact) {
    const top = L.topspin_rps;
    rows.push(['Vitesse de la balle', `${fmt(L.speed)} m/s · ${fmt(L.speed * 3.6, 0)} km/h`]);
    rows.push(['Spin vertical', `${top >= 0 ? 'Topspin' : 'Backspin'} ${fmt(Math.abs(top), 0)} tr/s`]);
    rows.push(['Effet latéral', Math.abs(L.sidespin_rps) < 1 ? 'aucun' : `${L.sidespin_rps > 0 ? 'vers la gauche' : 'vers la droite'} ${fmt(Math.abs(L.sidespin_rps), 0)} tr/s`]);
    if (Math.abs(L.axial_rps) >= 1) rows.push(['Tire-bouchon', `${fmt(Math.abs(L.axial_rps), 0)} tr/s`]);
    const b = j.bounces;
    rows.push(['1er rebond', b[0] ? `${fmt(-b[0][0] * 100, 0)} cm du filet · ${lateralText(b[0][1])}` : '—']);
    rows.push(['2e rebond', b[1] ? `${fmt(b[1][0] * 100, 0)} cm du filet · ${lateralText(b[1][1])}` : '—']);
    rows.push(['Garde au filet', j.net_clearance == null ? '—' : `${fmt(j.net_clearance * 100, 1)} cm`]);
    if (j.wall) {
      const Wl = j.wall;
      if (!Wl.hit) {
        rows.push(['Raquette adverse', 'la balle ne la touche pas']);
      } else {
        const vo = Wl.v_out, wo = Wl.w_out, spd = Math.hypot(vo[0], vo[1], vo[2]), vin = Math.hypot(Wl.v_in[0], Wl.v_in[1], Wl.v_in[2]);
        const hn = Math.hypot(vo[0], vo[1]) || 1, dx = vo[0] / hn, dy = vo[1] / hn;
        const topR = (wo[0] * -dy + wo[1] * dx) / (2 * Math.PI), sideR = wo[2] / (2 * Math.PI);   // spin of the returned ball
        const hx = Wl.hit_pos[0];
        rows.push(['Raquette adverse', `touchée à ${fmt(Math.abs(hx) * 100, 0)} cm du filet (côté ${hx > 0 ? 'receveur' : 'serveur'})`]);
        rows.push(['Vitesse au retour', `${fmt(spd)} m/s (arrivée : ${fmt(vin)} m/s)`]);
        rows.push(['Spin au retour', `${topR >= 0 ? 'Topspin' : 'Backspin'} ${fmt(Math.abs(topR), 0)} tr/s` +
          (Math.abs(sideR) >= 1 ? ` · latéral ${sideR > 0 ? 'gauche' : 'droite'} ${fmt(Math.abs(sideR), 0)} tr/s` : '')]);
        const iw = j.events.findIndex((e) => e.type === 'racket_hit');
        const nb = j.events.slice(iw + 1).find((e) => e.type === 'table_bounce');
        rows.push(['Après la raquette', nb ? `rebond à ${fmt(Math.abs(nb.pos[0]) * 100, 0)} cm du filet (côté ${nb.pos[0] > 0 ? 'receveur' : 'serveur'}) · ${lateralText(nb.pos[1])}` : 'pas de rebond sur la table']);
      }
    }
  } else {
    rows.push(['Contact', 'aucun : la raquette s’éloigne de la balle']);
  }
  let tags = '';
  if (j.third_bounce_on_table) tags += '<span class="tag warn">Service court : 3e rebond sur la table</span> ';
  if (j.bounces && j.bounces.length >= 2 && Math.abs(j.bounces[1][1]) > 0.15) {
    // The receiver faces the server, so his right is the server's left (y > 0): the backhand of a right-hander
    // is y < 0, the backhand of a left-hander is y > 0.
    const backhandSign = params.opp === 'R' ? -1 : 1;
    const side = Math.sign(j.bounces[1][1]) === backhandSign ? 'revers' : 'coup droit';
    tags += `<span class="tag">2e rebond : ${side} de l’adversaire ${params.opp === 'R' ? 'droitier' : 'gaucher'}</span> `;
  }
  if (j.bounces && j.bounces.length >= 3 && j.bounces[2][0] < j.bounces[1][0] - 0.02) {
    tags += `<span class="tag">La balle revient vers le filet${j.bounces[2][0] < 0 ? ' et repasse côté serveur' : ''}</span> `;
  }
  $('#metrics').innerHTML = `<h2>Le service</h2><dl class="m">${rows.map((r) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl><div style="margin-top:8px">${tags}</div>`;

  $('#contact-sub').textContent = j.contact ? `${fmt(I.contact_time_ms, 2)} ms · pic ${fmt(I.peak_force, 0)} N · enfoncement ${fmt(I.max_penetration_mm, 1)} mm` : '';
  $('#perf').textContent = backend.backendMode() === 'wasm'
    ? `Calcul C++ (WebAssembly, dans votre navigateur) ${j.server_ms.toFixed(2)} ms`
    : `Calcul C++ ${j.server_ms.toFixed(2)} ms · aller-retour ${rtt.toFixed(1)} ms`;
}

function setupCanvas(c) {
  const r = c.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h: r.height };
}

function drawMinimap(d) {
  const { g, w, h } = setupCanvas($('#minimap'));
  if (w < 40) return;   // right pane folded: nothing to draw on
  g.clearRect(0, 0, w, h);
  const { length: L, width: W } = cfg.table;
  const pad = 10, sc = Math.min((w - 2 * pad) / L, (h - 2 * pad) / W);
  const ox = w / 2, oy = h / 2;
  const X = (x) => ox + x * sc, Y = (y) => oy - y * sc;
  g.fillStyle = '#1b4f9a'; g.fillRect(X(-L / 2), Y(W / 2), L * sc, W * sc);
  g.fillStyle = 'rgba(70,211,154,.13)'; g.fillRect(X(-L / 2), Y(W / 2), (L / 2) * sc, W * sc);
  g.fillStyle = 'rgba(255,107,107,.10)'; g.fillRect(X(0), Y(W / 2), (L / 2) * sc, W * sc);
  g.strokeStyle = '#f4f6fa'; g.lineWidth = 1.5; g.strokeRect(X(-L / 2), Y(W / 2), L * sc, W * sc);
  g.beginPath(); g.moveTo(X(0), Y(W / 2) - 3); g.lineTo(X(0), Y(-W / 2) + 3); g.lineWidth = 2; g.stroke();
  g.beginPath(); g.moveTo(X(-L / 2), Y(0)); g.lineTo(X(L / 2), Y(0)); g.lineWidth = 0.6; g.stroke();
  g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '10px system-ui'; g.textAlign = 'center';
  g.fillText('serveur', X(-L / 4), Y(-W / 2) - 5); g.fillText('receveur', X(L / 4), Y(-W / 2) - 5);
  const j = d.raw;
  if (j.contact && d.P) {
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i < d.N; i++) { const x = d.P[3 * i], y = -d.P[3 * i + 2]; if (i) g.lineTo(X(x), Y(y)); else g.moveTo(X(x), Y(y)); }
    g.stroke();
    if (ghostData && ghostData.P) {
      g.strokeStyle = 'rgba(223,230,240,.28)'; g.setLineDash([3, 3]); g.beginPath();
      for (let i = 0; i < ghostData.N; i++) { const x = ghostData.P[3 * i], y = -ghostData.P[3 * i + 2]; if (i) g.lineTo(X(x), Y(y)); else g.moveTo(X(x), Y(y)); }
      g.stroke(); g.setLineDash([]);
    }
    (j.path_bounces || j.bounces).forEach((b, i) => {
      g.fillStyle = ['#ffa94d', '#ff5d5d', '#b388ff'][i]; g.beginPath(); g.arc(X(b[0]), Y(b[1]), 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#10151c'; g.font = 'bold 9px system-ui'; g.fillText(String(i + 1), X(b[0]), Y(b[1]) + 3);
    });
  }
  g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(X(j.racket.pos[0]), Y(j.racket.pos[1]), 3.5, 0, Math.PI * 2); g.fill();
  if (j.wall) {
    // the wall racket seen from above: a bar across the face, perpendicular to its normal
    const [cx, cy] = [j.wall.pos[0], j.wall.pos[1]], nx = j.wall.normal[0], ny = j.wall.normal[1];
    const hl = Math.hypot(nx, ny) || 1, tx = -ny / hl, ty = nx / hl, half = 0.08;
    g.strokeStyle = '#4da3ff'; g.lineWidth = 3.5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(X(cx - tx * half), Y(cy - ty * half)); g.lineTo(X(cx + tx * half), Y(cy + ty * half)); g.stroke();
    g.lineCap = 'butt';
  }
}

function drawContact(j) {
  const { g, w, h } = setupCanvas($('#contact'));
  if (w < 40) return;   // right pane folded: nothing to draw on
  g.clearRect(0, 0, w, h);
  if (!j.contact || !j.contact_trace_n) { g.fillStyle = '#93a1b3'; g.font = '12px system-ui'; g.fillText('pas de contact', 10, 20); return; }
  const f = b64ToF32(j.contact_trace_b64), M = j.contact_trace_n;
  const padL = 30, padB = 18, padT = 8, padR = 8;
  let tmax = f[5 * (M - 1)] * 1.02, fmax = 10;
  for (let i = 0; i < M; i++) fmax = Math.max(fmax, f[5 * i + 1], f[5 * i + 2]);
  fmax *= 1.1;
  const X = (t) => padL + (t / tmax) * (w - padL - padR), Y = (v) => h - padB - (v / fmax) * (h - padB - padT);
  g.strokeStyle = '#2a3646'; g.lineWidth = 1; g.beginPath(); g.moveTo(padL, Y(0)); g.lineTo(w - padR, Y(0)); g.moveTo(padL, padT); g.lineTo(padL, Y(0)); g.stroke();
  g.fillStyle = '#93a1b3'; g.font = '10px system-ui'; g.textAlign = 'right';
  g.fillText(fmax.toFixed(0) + ' N', padL - 3, padT + 8); g.fillText('0', padL - 3, Y(0));
  g.textAlign = 'center'; g.fillText(tmax.toFixed(1) + ' ms', w - padR - 14, h - 4); g.fillText('0', padL, h - 4);
  g.beginPath(); g.moveTo(X(0), Y(0));
  for (let i = 0; i < M; i++) g.lineTo(X(f[5 * i]), Y(f[5 * i + 1]));
  g.lineTo(X(f[5 * (M - 1)]), Y(0)); g.closePath(); g.fillStyle = 'rgba(76,194,255,.30)'; g.fill();
  g.strokeStyle = '#4cc2ff'; g.lineWidth = 1.6; g.beginPath();
  for (let i = 0; i < M; i++) { const x = X(f[5 * i]), y = Y(f[5 * i + 1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  g.strokeStyle = '#ffb454'; g.lineWidth = 1.4; g.beginPath();
  for (let i = 0; i < M; i++) { const x = X(f[5 * i]), y = Y(f[5 * i + 2]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  g.textAlign = 'left'; g.fillStyle = '#4cc2ff'; g.fillText('normale', padL + 8, padT + 10); g.fillStyle = '#ffb454'; g.fillText('frottement', padL + 56, padT + 10);
}

// ----------------------------------------------------------------------------- playback

const T_START = -0.22;
let animT = T_START, slow = 0.3, playing = true, hold = 0;
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

function ballAt(t) {
  const d = data;
  const g = cfg.gravity;
  const pos = tmpV;
  if (t < 0 || !d.contact) {
    // free flight before the racket (and after it, if the racket missed the ball)
    const dz = d.vIn * t - 0.5 * g * t * t;
    pos.copy(d.impact); pos.y = Math.max(ballR, d.impact.y + dz);
    tmpQ.identity();
    return { pos, q: tmpQ, w: null, idx: -1 };
  }
  // binary search in the sampled trajectory
  let lo = 0, hi = d.N - 1;
  if (t >= d.T[hi]) { pos.set(d.P[3 * hi], d.P[3 * hi + 1], d.P[3 * hi + 2]); return { pos, q: d.Q[hi], w: [d.W[3 * hi], d.W[3 * hi + 1], d.W[3 * hi + 2]], idx: hi }; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d.T[m] <= t) lo = m; else hi = m; }
  const u = (t - d.T[lo]) / Math.max(1e-9, d.T[hi] - d.T[lo]);
  pos.set(d.P[3 * lo] + u * (d.P[3 * hi] - d.P[3 * lo]), d.P[3 * lo + 1] + u * (d.P[3 * hi + 1] - d.P[3 * lo + 1]), d.P[3 * lo + 2] + u * (d.P[3 * hi + 2] - d.P[3 * lo + 2]));
  tmpQ.copy(d.Q[lo]).slerp(d.Q[hi], u);
  return { pos, q: tmpQ, w: [d.W[3 * lo], d.W[3 * lo + 1], d.W[3 * lo + 2]], idx: lo + u };
}

function replay() { animT = T_START; hold = 0; playing = true; $('#btn-play').textContent = 'Pause'; }

function updateScene(dt) {
  if (camAnim) {
    camAnim.t += dt / camAnim.dur;
    const u = clamp(camAnim.t, 0, 1), e = u * u * (3 - 2 * u);
    camera.position.lerpVectors(camAnim.fp, camAnim.tp, e);
    controls.target.lerpVectors(camAnim.ft, camAnim.tt, e);
    if (u >= 1) camAnim = null;
  }
  controls.update();
  if (!data) return;
  const d = data;
  if (playing) {
    if (animT > d.tEnd) { hold += dt; if (hold > 0.6) { animT = T_START; hold = 0; } } else animT += dt * slow;
  }
  const t = Math.min(animT, d.tEnd);

  // ball
  const b = ballAt(t);
  ball.position.copy(b.pos);
  ball.quaternion.copy(b.q);
  ball.visible = true;
  if (d.contact && t >= 0 && b.w) {
    const w = new THREE.Vector3(b.w[0], b.w[1], b.w[2]);
    const mag = w.length();
    const show = $('#chk-axis').checked && mag > 20;
    spinArrow.visible = show;
    if (show) {
      spinArrow.position.copy(b.pos).addScaledVector(w.clone().normalize(), -0.03 - 0.0001 * mag * 0 );
      spinArrow.setDirection(w.clone().normalize());
      spinArrow.setLength(0.06 + clamp(mag / 4000, 0, 0.12) , 0.03, 0.016);
    }
    setTubeProgress(tubeDone, Math.floor(b.idx));
  } else {
    spinArrow.visible = false;
    setTubeProgress(tubeDone, 0);
  }

  // racket: it approaches at its own velocity and stops right after the ball has left: a short follow-through of
  // at most 4 cm, so that a downward stroke never carries it through the table.
  const speedR = d.v.length();
  const stopT = Math.min(0.006, 0.04 / Math.max(speedR, 1e-6));    // seconds of travel at full speed, i.e. at most 4 cm
  const s = t <= 0 ? t : stopT * (1 - Math.exp(-t / 0.01));
  racket.position.copy(d.contactPoint).addScaledVector(d.v, s);
  racket.visible = true;
  velArrow.position.copy(d.contactPoint);
  normArrow.position.copy(d.contactPoint);

  // impact flash
  if (d.contact && t >= 0 && t < 0.12) {
    flash.visible = true;
    flash.position.copy(d.contactPoint);
    flash.lookAt(d.contactPoint.clone().add(d.n));
    flash.scale.setScalar(1 + t * 14);
    flash.material.opacity = 1 - t / 0.12;
  } else flash.visible = false;
  // flash where the ball bounces on the wall racket
  if (d.wall && d.wall.hit && t >= d.wall.t && t < d.wall.t + 0.12) {
    const u = t - d.wall.t;
    wallFlash.visible = true;
    wallFlash.position.copy(d.wall.pos);
    wallFlash.lookAt(d.wall.pos.clone().add(d.wall.n));
    wallFlash.scale.setScalar(1 + u * 14);
    wallFlash.material.opacity = 1 - u / 0.12;
  } else wallFlash.visible = false;
}

function resize() {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(10, r.width), h = Math.max(10, r.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (data) { drawMinimap(data); drawContact(data.raw); }
}

function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  updateScene(dt);
  renderer.render(scene, camera);
}

// ----------------------------------------------------------------------------- wiring

function pinGhost() {
  const btn = $('#btn-pin');
  if (ghostOn) { ghostOn = false; ghostData = null; tubeGhost.geo.setDrawRange(0, 0); btn.textContent = 'Épingler'; btn.classList.remove('on'); if (data) drawMinimap(data); return; }
  if (!data || !data.contact) return;
  updateTube(tubeGhost, data.P, null, data.N, 0.0026);
  ghostOn = true; ghostData = { P: data.P.slice(), N: data.N };
  btn.textContent = 'Retirer le fantôme'; btn.classList.add('on');
  drawMinimap(data);
}

// ----------------------------------------------------------------------------- side panes
// The two side panes fold away to leave the whole window to the 3D view. The choice is remembered.
const PANE_KEY = 'pingsim.panes';
function setPane(side, open, save = true) {
  $('#app').classList.toggle('hide-' + side, !open);
  const btn = $('#toggle-' + side);
  btn.setAttribute('aria-expanded', String(open));
  // arrows point to where the pane goes when folded, or where it comes from when unfolded
  btn.textContent = (side === 'left') === open ? '‹' : '›';
  btn.title = `${open ? 'Replier' : 'Déplier'} le volet de ${side === 'left' ? 'gauche  ( [ )' : 'droite  ( ] )'}`;
  if (save) {
    try { localStorage.setItem(PANE_KEY, JSON.stringify({ left: !$('#app').classList.contains('hide-left'), right: !$('#app').classList.contains('hide-right') })); } catch (e) { /* private mode: not remembered */ }
  }
  resize();   // the 3D view changes size
}
function restorePanes() {
  let s = { left: true, right: true };
  try { s = { ...s, ...JSON.parse(localStorage.getItem(PANE_KEY) || '{}') }; } catch (e) { /* ignore */ }
  setPane('left', s.left !== false, false);
  setPane('right', s.right !== false, false);
}

function wire() {
  $('#cam-select').addEventListener('change', (e) => goCam(e.target.value));
  $('#speed-select').addEventListener('change', (e) => { slow = parseFloat(e.target.value); });
  $('#toggle-left').addEventListener('click', () => setPane('left', $('#app').classList.contains('hide-left')));
  $('#toggle-right').addEventListener('click', () => setPane('right', $('#app').classList.contains('hide-right')));
  $('#btn-play').addEventListener('click', () => { playing = !playing; $('#btn-play').textContent = playing ? 'Pause' : 'Lecture'; });
  $('#btn-replay').addEventListener('click', replay);
  $('#btn-pin').addEventListener('click', pinGhost);
  $('#btn-reset').addEventListener('click', () => { params = { ...DEFAULTS, hand: params.hand, opp: params.opp }; clearPresetChoice(); syncControls(); requestCompute(); saveHash(); replay(); });
  // Handedness. "Vous" mirrors the lateral settings (a left-hander's gesture is the mirror image); "Adversaire"
  // only changes the labels (backhand / forehand) of the landing side.
  for (const b of document.querySelectorAll('#seg-hand button')) b.addEventListener('click', () => {
    if (params.hand === b.dataset.v) return;
    params = mirrorLateral({ ...params, hand: b.dataset.v });
    syncControls(); requestCompute(); saveHash();
  });
  for (const b of document.querySelectorAll('#seg-opp button')) b.addEventListener('click', () => {
    params.opp = b.dataset.v; syncControls(); saveHash();
    if (lastResult) updateHud(lastResult.j, lastResult.rtt);
    if (lastResult && lastResult.j.wall) {   // the receiver's racket is held in the other hand: redraw it tilted the other way
      orientGroup(wallRacket, P3(...lastResult.j.wall.normal), rollFor(params.opp));
    }
  });
  // racket panels: fold / unfold, and the receiving racket's switch and "snap to the ball" button
  for (const b of document.querySelectorAll('.ovp-toggle')) b.addEventListener('click', () => {
    setPanelOpen(b.closest('.ovp'), b.closest('.ovp').classList.contains('closed'));
  });
  $('#chk-wall').addEventListener('change', (e) => {
    setParam('wall', e.target.checked ? 1 : 0);
    if (e.target.checked) setPanelOpen($('#panel-recv'), true);
  });
  $('#btn-wall-place').addEventListener('click', placeWallOnPath);
  $('#btn-link').addEventListener('click', async () => {
    const btn = $('#btn-link');
    try { await navigator.clipboard.writeText(location.href); btn.textContent = 'Lien copié ✔'; } catch (e) { btn.textContent = 'Copie impossible'; }
    setTimeout(() => (btn.textContent = 'Copier le lien'), 1500);
  });
  window.addEventListener('keydown', (e) => {
    // do not steal keys while a number is typed or a drop-down list is used
    if (e.target && ((e.target.tagName === 'INPUT' && e.target.type === 'number') || e.target.tagName === 'SELECT')) return;
    if (e.code === 'Space') { e.preventDefault(); $('#btn-play').click(); }
    else if (e.key === 'r' || e.key === 'R') replay();
    else if (e.key === '[') $('#toggle-left').click();
    else if (e.key === ']') $('#toggle-right').click();
  });
  new ResizeObserver(resize).observe(canvas);
}

async function main() {
  try {
    cfg = (await backend.init()).config;
  } catch (e) {
    $('#status').className = 'badge ko'; $('#status').textContent = 'Noyau C++ injoignable : lancez python/labserver.py (' + e.message + ')'; return;
  }
  loadHash();
  buildControls(); buildRubberChips(); buildPresets(); syncControls();
  if (params.wall) setPanelOpen($('#panel-recv'), true);   // a shared link that uses the receiving racket opens its panel
  buildEnvironment(); buildRacket(params.rubber);
  wire(); restorePanes(); resize(); goCam('three', true);
  updateGizmo();
  renderer.setAnimationLoop(loop);
  requestCompute();
  // Debug/automation hook: render the scene at a given playback time without relying on rAF.
  window.__lab = {
    get data() { return data; }, params: () => params, setParam, replay, pause: () => { playing = false; },
    renderAt: (t) => { playing = false; animT = t; updateScene(0); renderer.render(scene, camera); },
    three: { scene, camera, renderer }, gizmo, gizmoRecv, racket, wallRacket,
  };
}
main();

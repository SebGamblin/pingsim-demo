// Interactive parts of the "Méthodes de calcul" page: math rendering, two calculators, table of contents highlight.
import { BALL, AIR, forces, tableBounce } from './calc.js';

const $ = (s) => document.querySelector(s);
const fr = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const sgn = (v) => (v >= 0 ? '+' : '−');

// --- formulas (KaTeX is loaded with `defer` before this module runs)
function renderMath() {
  if (!window.renderMathInElement) return;
  window.renderMathInElement(document.body, {
    delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
    throwOnError: false,
  });
}

// --- calculator 1: weight, drag, Magnus
function initMagnus() {
  const v = $('#m-v'), s = $('#m-s');
  const update = () => {
    const f = forces({ v: Number(v.value), spinRps: Number(s.value) });
    $('#m-v-o').textContent = `${fr(Number(v.value), 1)} m/s (${fr(Number(v.value) * 3.6, 0)} km/h)`;
    $('#m-s-o').textContent = `${fr(Number(s.value), 0)} tr/s`;
    $('#m-S').textContent = fr(f.S, 2);
    $('#m-CL').textContent = fr(f.CL, 3);
    $('#m-aM').textContent = `${fr(f.accelMagnus, 1)} m/s²`;
    $('#m-vl').textContent = `${fr(f.terminal, 1)} m/s`;
    const max = Math.max(f.weight, f.drag, f.magnus, 1e-9);
    const row = (label, val, color) => `<div class="bar"><span>${label}</span><i style="width:${Math.max(0.5, (100 * val) / max)}%;background:${color}"></i><em>${fr(val, 4)} N</em></div>`;
    $('#m-bars').innerHTML = row('Poids', f.weight, '#93a1b3') + row('Traînée', f.drag, '#ffb454') + row('Magnus', f.magnus, '#4cc2ff');
    const ratio = f.magnus / f.weight;
    $('#m-verdict').innerHTML = f.magnus === 0
      ? 'Sans spin, il n’y a pas de force de Magnus : la trajectoire est une parabole freinée par l’air.'
      : `La force de Magnus vaut <b>${fr(ratio, 1)} fois le poids</b> de la balle et ${fr(f.magnus / f.drag, 2)} fois la traînée. ` +
        'Pour une balle qui avance vers +x avec du topspin elle pousse vers le bas ; avec du backspin, vers le haut.';
  };
  v.addEventListener('input', update); s.addEventListener('input', update); update();
}

// --- calculator 2: bounce on the table (vertical plane)
function initBounce() {
  const ids = { vx: '#b-vx', vz: '#b-vz', s: '#b-s', mu: '#b-mu', e: '#b-e' };
  const el = Object.fromEntries(Object.entries(ids).map(([k, q]) => [k, $(q)]));
  const svg = $('#b-fig');
  const update = () => {
    const vx = Number(el.vx.value), vz = Number(el.vz.value), spin = Number(el.s.value), mu = Number(el.mu.value), e = Number(el.e.value);
    $('#b-vx-o').textContent = `${fr(vx, 1)} m/s`; $('#b-vz-o').textContent = `${fr(vz, 1)} m/s`;
    $('#b-s-o').textContent = `${spin >= 0 ? 'topspin' : 'backspin'} ${fr(Math.abs(spin), 0)} tr/s`;
    $('#b-mu-o').textContent = fr(mu, 2); $('#b-e-o').textContent = fr(e, 2);
    const o = tableBounce({ vx, vz, spinRps: spin, mu, e });
    $('#b-vx2').textContent = `${fr(o.vx, 2)} m/s`;
    $('#b-vz2').textContent = `${fr(o.vz, 2)} m/s`;
    $('#b-s2').textContent = `${o.spinRps >= 0 ? 'topspin' : 'backspin'} ${fr(Math.abs(o.spinRps), 0)} tr/s`;
    $('#b-reg').textContent = o.sticking ? 'adhérence (roule)' : 'glissement';
    const ang = (a, b) => (Math.atan2(Math.abs(b), Math.abs(a)) * 180) / Math.PI;
    const back = o.vx < -0.005;
    $('#b-verdict').innerHTML =
      `La balle arrive avec un angle de <b>${fr(ang(vx, vz), 0)}°</b> et repart avec <b>${fr(ang(o.vx, o.vz), 0)}°</b>` +
      `${back ? ', <b>vers l’arrière</b> (elle revient vers le serveur)' : ''}. ` +
      (o.sticking ? 'Le frottement suffit à arrêter le glissement : la balle roule au décollage.'
        : `Le frottement atteint sa limite μ·J<sub>n</sub> : il change la vitesse horizontale de ${sgn(o.vx - vx)}${fr(Math.abs(o.vx - vx), 2)} m/s.`);
    // figure: incoming and outgoing velocity vectors around the contact point. The scale adapts so that the
    // arrows fill the picture whatever the speeds (the ball arrives from the left and moves towards +x).
    const cx = 320, cy = 160, vmaxX = Math.max(1, Math.abs(vx), Math.abs(o.vx)), vmaxZ = Math.max(1, vz, Math.abs(o.vz));
    const k = Math.min(60, 270 / vmaxX, 135 / vmaxZ);
    const X = (v) => cx + k * v, Y = (v) => cy - 4 - k * v;
    const tailX = X(-vx), tailY = Y(vz), tipX = X(o.vx), tipY = Y(o.vz);
    const speed = (a, b) => `${fr(Math.hypot(a, b), 1)} m/s`;
    const arrow = (x1, y1, x2, y2, color) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3.5" stroke-linecap="round" marker-end="url(#ba-${color.slice(1)})"/>`;
    const label = (x, y, anchor, color, txt) => `<text x="${x}" y="${y}" text-anchor="${anchor}" style="fill:${color};font-weight:700;font-size:13px">${txt}</text>`;
    svg.innerHTML = `<defs>` + ['4cc2ff', 'ffb454'].map((c) => `<marker id="ba-${c}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#${c}"/></marker>`).join('') + `</defs>` +
      `<rect x="0" y="160" width="640" height="50" fill="#1b4f9a" opacity=".55"/><line x1="0" y1="160" x2="640" y2="160" stroke="#f4f6fa" stroke-width="2"/>` +
      arrow(tailX, tailY, cx, cy - 4, '#4cc2ff') + arrow(cx, cy - 4, tipX, tipY, '#ffb454') +
      `<circle cx="${cx}" cy="${cy - 4}" r="4.5" fill="#fff"/>` +
      label(tailX - 8, Math.max(16, tailY + 4), 'end', '#4cc2ff', `avant : ${speed(vx, vz)}`) +
      label(tipX + 8, Math.max(16, tipY + 4), 'start', '#ffb454', `après : ${speed(o.vx, o.vz)}`) +
      `<text x="12" y="198" class="muted">table</text>` +
      `<text x="628" y="198" text-anchor="end" class="muted">échelle : 1 m/s = ${fr(k, 0)} px</text>`;
  };
  Object.values(el).forEach((n) => n.addEventListener('input', update));
  update();
}

// --- table of contents: highlight the section being read
function initToc() {
  const links = [...document.querySelectorAll('nav.toc a')];
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  if (!('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { links.forEach((a) => a.classList.remove('on')); byId.get(en.target.id)?.classList.add('on'); }
  }, { rootMargin: '-15% 0px -70% 0px' });
  document.querySelectorAll('main section[id]').forEach((s) => obs.observe(s));
}

function start() {
  void BALL; void AIR;
  initMagnus(); initBounce(); initToc();
  // KaTeX scripts are `defer`red: they have run by now (modules are deferred too, in document order).
  renderMath();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

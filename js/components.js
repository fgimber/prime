import { html, useEffect, useRef, useState } from './lib.js';
import { r0, shortDate } from './util.js';

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/><path d="M6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  barcode: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/><path d="M19 3v4M17 5h4"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  swap: '<path d="M16 3l4 4-4 4"/><path d="M20 7H8"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h12"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  droplet: '<path d="M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h2l2.7 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L22 7H5.1"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 15v2c0 1-1 1.5-2 2.5S7 21 7 22M14 15v2c0 1 1 1.5 2 2.5s1 1.5 1 2.5M18 2H6v7a6 6 0 0 0 12 0z"/>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  dumbbell: '<path d="M14.4 14.4 9.6 9.6M18.66 21.49a2 2 0 1 1-2.83-2.83l-1.77 1.77a2 2 0 1 1-2.83-2.83l6.36-6.36a2 2 0 1 1 2.83 2.83l-1.77 1.77a2 2 0 1 1 2.83 2.83zM21.5 21.5l-1.4-1.4M3.9 3.9 2.5 2.5M6.4 12.77a2 2 0 1 1-2.83-2.83l1.77-1.77a2 2 0 1 1-2.83-2.83l2.83-2.83a2 2 0 1 1 2.83 2.83l1.77-1.77a2 2 0 1 1 2.83 2.83z"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  face: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
};

export function Icon({ name, size = 20 }) {
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;
}

export function Sheet({ title, onClose, children, z, closing }) {
  const ref = useRef();
  const drag = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  // Arrastrar hacia abajo desde la manija / título para cerrar.
  const start = (e) => { drag.current = { y: e.touches[0].clientY, t: Date.now(), dy: 0 }; ref.current.style.transition = 'none'; };
  const move = (e) => {
    if (!drag.current) return;
    const dy = Math.max(0, e.touches[0].clientY - drag.current.y);
    drag.current.dy = dy;
    ref.current.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    ref.current.style.transition = '';
    if (d.dy > 110 || (d.dy > 40 && Date.now() - d.t < 250)) { ref.current.style.transform = 'translateY(100%)'; onClose(); }
    else ref.current.style.transform = '';
  };
  return html`
    <div class=${'sheet-backdrop' + (closing ? ' closing' : '')} style=${{ zIndex: 100 + z * 2 }} onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <section class=${'sheet' + (closing ? ' closing' : '')} ref=${ref} role="dialog" aria-label=${title}>
        <div class="sheet-grab" onTouchStart=${start} onTouchMove=${move} onTouchEnd=${end}>
          <span class="grabber"></span>
          <header class="sheet-head">
            <h2>${title}</h2>
            <button class="icon-btn" onClick=${onClose} aria-label="Cerrar"><${Icon} name="x" /></button>
          </header>
        </div>
        <div class="sheet-body">${children}</div>
      </section>
    </div>`;
}

// Número que se anima contando hasta el valor (al abrir y cuando cambia).
export function useCountUp(value, ms = 700) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = +value || 0;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(a + (b - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = b; };
  }, [value]);
  return v;
}

let ringId = 0;
export function Ring({ value, target, size = 172 }) {
  const stroke = 14, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const [id] = useState(() => 'rg' + ++ringId);
  const pct = target ? Math.min(value / target, 1) : 0;
  const over = target && value > target;
  const shown = useCountUp(Math.abs(r0(target - value)));
  const [p, setP] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setP(pct)); return () => cancelAnimationFrame(t); }, [pct]);
  return html`
    <div class=${'ring' + (over ? ' over' : '') + (pct >= 0.98 && !over ? ' full' : '')} style=${{ width: size + 'px', height: size + 'px' }}>
      <svg width=${size} height=${size}>
        <defs>
          <linearGradient id=${id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color=${over ? '#FF8A8A' : '#D4FF7A'} />
            <stop offset="1" stop-color=${over ? 'var(--danger)' : 'var(--accent)'} />
          </linearGradient>
        </defs>
        <circle cx=${size / 2} cy=${size / 2} r=${r} stroke="var(--track)" stroke-width=${stroke} fill="none" />
        <circle class="ring-prog" cx=${size / 2} cy=${size / 2} r=${r} stroke=${`url(#${id})`} stroke-width=${stroke} fill="none"
          stroke-linecap="round" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - p)}
          transform=${`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div class="ring-label">
        <strong>${Math.round(shown)}</strong>
        <span>${over ? 'kcal de más' : 'kcal restantes'}</span>
        <em>${Math.round(pct * 100)}%</em>
      </div>
    </div>`;
}

export function MacroBar({ label, value, target, color }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const [w, setW] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setW(pct)); return () => cancelAnimationFrame(t); }, [pct]);
  const shown = useCountUp(r0(value));
  return html`
    <div class=${'macro' + (pct >= 100 ? ' full' : '')} style=${{ '--mc': color }}>
      <div class="macro-top"><span>${label}</span><span class="macro-pct">${Math.round(pct)}%</span></div>
      <div class="bar"><div style=${{ width: w + '%' }}></div></div>
      <span class="macro-val"><b>${Math.round(shown)}</b>${target ? ` / ${r0(target)}` : ''} g</span>
    </div>`;
}

export function MacroPills({ m, compact }) {
  return html`<span class=${'pills' + (compact ? ' compact' : '')}>
    <span class="pill p">P ${r0(m.protein)}</span><span class="pill c">C ${r0(m.carbs)}</span><span class="pill f">G ${r0(m.fat)}</span>
  </span>`;
}

export function Field({ label, hint, children }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint && html`<small class="muted">${hint}</small>`}</label>`;
}

export function Segmented({ value, options, onChange }) {
  return html`<div class="segmented">
    ${options.map((o) => html`<button class=${value === o.id ? 'on' : ''} onClick=${() => onChange(o.id)}>${o.icon && html`<${Icon} name=${o.icon} size=${16} />`}${o.label}</button>`)}
  </div>`;
}

export const Spinner = ({ label }) => html`<div class="spinner-wrap"><div class="spinner"></div>${label && html`<span class="muted">${label}</span>`}</div>`;

export const Empty = ({ children }) => html`<div class="empty muted">${children}</div>`;

// Gráfico de línea simple en SVG (peso).
export function LineChart({ points, goal, height = 180, unit = 'kg' }) {
  if (points.length < 2) return html`<${Empty}>Registrá al menos 2 pesos para ver el gráfico.<//>`;
  const W = 340, H = height, pad = { l: 34, r: 10, t: 12, b: 22 };
  const ys = points.map((p) => p.y).concat(goal ? [goal] : []);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (max - min < 2) { min -= 1; max += 1; }
  const t0 = new Date(points[0].x).getTime(), t1 = new Date(points[points.length - 1].x).getTime();
  const X = (x) => pad.l + ((new Date(x).getTime() - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - min) / (max - min)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area = `${d} L${X(points[points.length - 1].x)},${H - pad.b} L${X(points[0].x)},${H - pad.b} Z`;
  return html`
    <svg class="chart" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Evolución de peso">
      <defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".25"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      ${[min, (min + max) / 2, max].map((v) => html`<g><line x1=${pad.l} x2=${W - pad.r} y1=${Y(v)} y2=${Y(v)} stroke="var(--line)" /><text x=${pad.l - 6} y=${Y(v) + 4} text-anchor="end" class="axis">${v.toFixed(1)}</text></g>`)}
      ${goal && html`<g><line x1=${pad.l} x2=${W - pad.r} y1=${Y(goal)} y2=${Y(goal)} stroke="var(--gold)" stroke-dasharray="5 4" stroke-width="1.5" /><text x=${W - pad.r} y=${Y(goal) - 5} text-anchor="end" class="axis gold">Prime ${goal} ${unit}</text></g>`}
      <path d=${area} fill="url(#lg)" />
      <path d=${d} fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" />
      ${points.map((p) => html`<circle cx=${X(p.x)} cy=${Y(p.y)} r="3" fill="var(--card)" stroke="var(--accent)" stroke-width="2" />`)}
      <text x=${pad.l} y=${H - 5} class="axis">${shortDate(points[0].x)}</text>
      <text x=${W - pad.r} y=${H - 5} text-anchor="end" class="axis">${shortDate(points[points.length - 1].x)}</text>
    </svg>`;
}

// Barras de calorías diarias vs objetivo.
export function BarChart({ bars, target, height = 150 }) {
  const W = 340, H = height, pad = { l: 6, r: 6, t: 10, b: 20 };
  const max = Math.max(target || 0, ...bars.map((b) => b.v)) * 1.1 || 1;
  const bw = (W - pad.l - pad.r) / bars.length;
  const Y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  return html`
    <svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Calorías por día">
      ${bars.map((b, i) => {
        const over = target && b.v > target * 1.05;
        return html`<g>
          <rect x=${pad.l + i * bw + bw * 0.18} y=${Y(b.v)} width=${bw * 0.64} height=${Math.max(0, H - pad.b - Y(b.v))} rx="3" fill=${b.v ? (over ? 'var(--danger)' : 'var(--accent)') : 'var(--track)'} opacity=${b.v ? 1 : 0.6}><title>${b.label}: ${r0(b.v)} kcal</title></rect>
          <text x=${pad.l + i * bw + bw / 2} y=${H - 6} text-anchor="middle" class="axis">${b.short}</text>
        </g>`;
      })}
      ${target && html`<line x1=${pad.l} x2=${W - pad.r} y1=${Y(target)} y2=${Y(target)} stroke="var(--text)" stroke-opacity=".5" stroke-dasharray="4 4" />`}
    </svg>`;
}

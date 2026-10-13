import { html, render, useState, useEffect, useMemo, useCallback, useRef, AppCtx } from './lib.js';
import { auth, db, isCloud } from './store.js';
import { computeTargets, mealsFor } from './nutrition.js';
import { lockEnabled } from './lock.js';
import { Icon, Sheet, Spinner } from './components.js';
import { AuthView, NewPasswordView, LockView } from './views/auth.js';
import { TodayView } from './views/today.js';
import { GymView } from './views/gym.js';
import { ComidaView } from './views/comida.js';
import { ProgressView } from './views/progress.js';
import { ProfileView } from './views/profile.js';

const TABS = [
  { id: 'hoy', label: 'Hoy', icon: 'utensils', View: TodayView },
  { id: 'gym', label: 'Gym', icon: 'dumbbell', View: GymView },
  { id: 'comida', label: 'Comida', icon: 'book', View: ComidaView },
  { id: 'progreso', label: 'Progreso', icon: 'chart', View: ProgressView },
  { id: 'perfil', label: 'Perfil', icon: 'user', View: ProfileView },
];
const ALIAS = { plan: 'comida', recetas: 'comida' };
const LOCK_AFTER_MS = 5 * 60 * 1000;

function tabFromHash() {
  const h = location.hash.slice(1);
  const t = ALIAS[h] || h;
  return TABS.some((x) => x.id === t) ? t : null;
}

const rowToDay = (r) => ({ ...(r.data || {}), c: r.data?.c || {}, water_ml: r.water_ml || 0 });

function App() {
  const [user, setUser] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  const [locked, setLocked] = useState(() => lockEnabled());
  const [profile, setProfile] = useState(undefined);
  const [days, setDays] = useState({});
  const [tab, setTabState] = useState(() => tabFromHash() || 'hoy');
  const [dir, setDir] = useState(0);
  const mainRef = useRef();
  const swipe = useRef(null);
  const [sheets, setSheets] = useState([]);
  const [toastMsg, setToastMsg] = useState(null);
  const [version, setVersion] = useState(0);
  const queues = useRef({});

  const toast = useCallback((msg, type = 'ok') => setToastMsg({ msg, type, id: Date.now() }), []);

  useEffect(() => {
    auth.getUser().then(setUser).catch(() => setUser(null));
    return auth.onChange((u, event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setUser((prev) => (prev?.id === u?.id ? prev : u));
    });
  }, []);

  // Volver a bloquear si la app estuvo en segundo plano un rato.
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && lockEnabled()) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const loadDays = useCallback(() => db.list('days', {}).then((rows) => {
    const map = {};
    rows.forEach((r) => { map[r.date] = rowToDay(r); });
    setDays(map);
  }), []);

  useEffect(() => {
    setSheets([]);
    if (!user) { setProfile(user === null ? null : undefined); setDays({}); return; }
    setProfile(undefined);
    db.getProfile().then((p) => setProfile(p || {})).catch((e) => { toast(e.message, 'error'); setProfile({}); });
    loadDays().catch((e) => toast(e.message, 'error'));
  }, [user?.id]);

  useEffect(() => {
    const onHash = () => { const t = tabFromHash(); if (t) setTabState(t); };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const idx = (t) => TABS.findIndex((x) => x.id === t);
  const setTab = useCallback((t) => {
    setTabState((cur) => { if (cur !== t) setDir(idx(t) > idx(cur) ? 1 : -1); return t; });
    history.replaceState(null, '', '#' + t);
    scrollTo(0, 0);
  }, []);

  // Deslizar con el dedo para cambiar de pestaña (como en una app nativa).
  const onTouchStart = (e) => {
    if (e.touches.length !== 1 || e.target.closest('input, textarea, select, .tscroll, .no-swipe, .sheet')) { swipe.current = null; return; }
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY, t: Date.now(), lock: null };
  };
  const onTouchMove = (e) => {
    const s = swipe.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (s.lock == null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) s.lock = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
    if (s.lock !== 'x') return;
    if (e.cancelable) e.preventDefault(); // gesto horizontal: la página no se mueve
    const i = idx(tab);
    const edge = (dx > 0 && i === 0) || (dx < 0 && i === TABS.length - 1);
    const el = mainRef.current?.firstElementChild;
    if (el) { el.style.transition = 'none'; el.style.transform = `translateX(${dx * (edge ? 0.15 : 0.35)}px)`; el.style.opacity = String(1 - Math.min(Math.abs(dx) / 900, 0.25)); }
    s.dx = dx;
  };
  const onTouchEnd = () => {
    const s = swipe.current;
    swipe.current = null;
    const el = mainRef.current?.firstElementChild;
    if (el) { el.style.transition = 'transform .25s var(--ease), opacity .25s'; el.style.transform = ''; el.style.opacity = ''; }
    if (!s || s.lock !== 'x') return;
    const fast = Math.abs(s.dx) > 40 && Date.now() - s.t < 300;
    if (Math.abs(s.dx) < 70 && !fast) return;
    const next = TABS[idx(tab) + (s.dx < 0 ? 1 : -1)];
    if (next) { navigator.vibrate?.(8); setTab(next.id); }
  };
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), toastMsg.type === 'error' ? 4500 : 2200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const openSheet = useCallback((node, title) => setSheets((s) => [...s, { node, title, id: Date.now() + Math.random() }]), []);
  // Cerrar con animación: se marca "closing" y se quita al terminar la transición.
  const closeSheet = useCallback((n = 1) => {
    setSheets((s) => {
      const open = s.filter((x) => !x.closing);
      const ids = new Set(open.slice(Math.max(0, open.length - n)).map((x) => x.id));
      setTimeout(() => setSheets((cur) => cur.filter((x) => !ids.has(x.id))), 240);
      return s.map((x) => (ids.has(x.id) ? { ...x, closing: true } : x));
    });
  }, []);
  const closeAll = useCallback(() => setSheets([]), []);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const saveProfile = useCallback(async (p) => { setProfile(p); await db.saveProfile(p); }, []);

  // Guarda un día de hábitos (checks, gym, rutina…) en orden, sin pisar el agua.
  const persistDay = useCallback((k, row) => {
    const q = queues.current[k] || (queues.current[k] = { p: Promise.resolve() });
    q.p = q.p.then(() => db.upsert('days', { date: k, ...row }, 'user_id,date')).catch((e) => toast(e.message, 'error'));
  }, []);

  const updateDay = useCallback((k, fn) => {
    setDays((all) => {
      const cur = all[k] || { c: {}, water_ml: 0 };
      const next = fn({ ...cur, c: { ...cur.c } });
      const { water_ml, ...data } = next;
      persistDay(k, { data });
      return { ...all, [k]: next };
    });
  }, []);

  const setWater = useCallback((k, ml) => {
    setDays((all) => {
      const cur = all[k] || { c: {}, water_ml: 0 };
      persistDay(k, { water_ml: Math.max(0, ml) });
      return { ...all, [k]: { ...cur, water_ml: Math.max(0, ml) } };
    });
  }, []);

  useEffect(() => { document.body.style.overflow = sheets.some((s) => !s.closing) ? 'hidden' : ''; }, [sheets]);

  const targets = useMemo(() => computeTargets(profile), [profile]);
  const meals = useMemo(() => mealsFor(profile), [profile]);
  const H = useMemo(() => ({ settings: profile?.gym || {}, plan: profile?.plan || null, days }), [profile, days]);

  const ctx = {
    user, profile: profile || {}, saveProfile, targets, meals, version, bump, openSheet, closeSheet, closeAll, toast, tab, setTab,
    H, updateDay, setWater, loadDays,
  };

  let body;
  if (user === undefined || (user && profile === undefined)) body = html`<div class="boot"><${Spinner} label="Cargando…" /></div>`;
  else if (recovery) body = html`<${NewPasswordView} onDone=${() => setRecovery(false)} />`;
  else if (!user) body = html`<${AuthView} />`;
  else if (locked && lockEnabled()) body = html`<${LockView} onUnlock=${() => setLocked(false)} />`;
  else if (!targets) body = html`<main class="onboarding"><${ProfileView} onboarding /></main>`;
  else {
    const Current = TABS.find((t) => t.id === tab)?.View || TodayView;
    body = html`
      ${!isCloud && tab === 'hoy' && html`<div class="banner">Modo local: los datos se guardan solo en este dispositivo. <a href="#perfil">Más info</a></div>`}
      <main ref=${mainRef} onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd} onTouchCancel=${onTouchEnd}>
        <div class=${'view-anim ' + (dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : 'fade')} key=${tab}><${Current} /></div>
      </main>
      <nav class="tabbar">
        <span class="tab-pill" style=${{ transform: `translateX(${idx(tab) * 100}%)` }}></span>
        ${TABS.map((t) => html`<button class=${tab === t.id ? 'on' : ''} onClick=${() => setTab(t.id)} aria-label=${t.label}><${Icon} name=${t.icon} size=${22} /><span>${t.label}</span></button>`)}
      </nav>`;
  }

  return html`<${AppCtx.Provider} value=${ctx}>
    ${body}
    ${sheets.map((s, i) => html`<${Sheet} key=${s.id} z=${i} title=${s.title} closing=${s.closing} onClose=${() => closeSheet()}>${s.node}<//>`)}
    ${toastMsg && html`<div class=${'toast ' + toastMsg.type} key=${toastMsg.id} role="status">${toastMsg.msg}</div>`}
  <//>`;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

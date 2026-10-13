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

  const setTab = useCallback((t) => { setTabState(t); history.replaceState(null, '', '#' + t); scrollTo(0, 0); }, []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), toastMsg.type === 'error' ? 4500 : 2200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const openSheet = useCallback((node, title) => setSheets((s) => [...s, { node, title, id: Date.now() + Math.random() }]), []);
  const closeSheet = useCallback((n = 1) => setSheets((s) => s.slice(0, Math.max(0, s.length - n))), []);
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

  useEffect(() => { document.body.style.overflow = sheets.length ? 'hidden' : ''; }, [sheets.length]);

  const targets = useMemo(() => computeTargets(profile), [profile]);
  const meals = useMemo(() => mealsFor(profile), [profile]);
  const H = useMemo(() => ({ settings: profile?.gym || {}, days }), [profile, days]);

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
      <main><${Current} key=${tab} /></main>
      <nav class="tabbar">
        ${TABS.map((t) => html`<button class=${tab === t.id ? 'on' : ''} onClick=${() => setTab(t.id)} aria-label=${t.label}><${Icon} name=${t.icon} size=${22} /><span>${t.label}</span></button>`)}
      </nav>`;
  }

  return html`<${AppCtx.Provider} value=${ctx}>
    ${body}
    ${sheets.map((s, i) => html`<${Sheet} key=${s.id} z=${i} title=${s.title} onClose=${() => closeSheet()}>${s.node}<//>`)}
    ${toastMsg && html`<div class=${'toast ' + toastMsg.type} key=${toastMsg.id} role="status">${toastMsg.msg}</div>`}
  <//>`;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Capa de datos: Supabase (nube, con login) o localStorage (modo local) con la misma interfaz.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const isCloud = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let sbPromise = null;
function sb() {
  if (!sbPromise) {
    sbPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    );
  }
  return sbPromise;
}

let uid = null;
const LOCAL_USER = { id: 'local', email: 'Modo local' };

// ---------- Varias cuentas en el mismo dispositivo ----------
// Se guardan las sesiones de cada cuenta para cambiar con un toque. Los datos siguen separados en Supabase (RLS).
const ACC = 'prime:accounts';
const accList = () => { try { return JSON.parse(localStorage.getItem(ACC)) || []; } catch { return []; } };
const accSave = (list) => { try { localStorage.setItem(ACC, JSON.stringify(list)); } catch {} };
function rememberSession(session, name) {
  if (!session?.user) return;
  const prev = accList().find((a) => a.id === session.user.id);
  const list = accList().filter((a) => a.id !== session.user.id);
  // Se guarda la sesión completa (igual que la guarda Supabase) para poder restaurarla tal cual.
  list.unshift({ id: session.user.id, email: session.user.email, name: name || prev?.name || '', session });
  accSave(list.slice(0, 6));
}
const RETURN = 'prime:returnTo';
export const accounts = {
  list: () => accList().map(({ id, email, name }) => ({ id, email, name })),
  setName(id, name) { accSave(accList().map((a) => (a.id === id ? { ...a, name } : a))); },
  forget(id) { accSave(accList().filter((a) => a.id !== id)); },
  // Cuenta a la que volver si se arrepiente de agregar otra.
  returnTo() { try { const id = localStorage.getItem(RETURN); return accounts.list().find((a) => a.id === id) || null; } catch { return null; } },
  clearReturn() { try { localStorage.removeItem(RETURN); } catch {} },
  async switchTo(id) {
    const a = accList().find((x) => x.id === id);
    // Formato anterior: solo tokens. Se arma una sesión vencida y Supabase la renueva sola al abrir.
    const session = a?.session || (a?.refresh_token && {
      access_token: a.access_token, refresh_token: a.refresh_token, token_type: 'bearer',
      expires_in: 0, expires_at: 0, user: { id: a.id, email: a.email, aud: 'authenticated', role: 'authenticated' },
    });
    if (!session) throw new Error('Esa cuenta no está guardada en este dispositivo: entrá con su email y contraseña.');
    a.session = session;
    const c = await sb();
    try { localStorage.setItem(c.auth.storageKey, JSON.stringify(session)); } catch {}
    accounts.clearReturn();
    location.reload();
  },
  // Sale de la cuenta actual SOLO en este dispositivo (sin cerrar su sesión), para poder entrar con otra.
  async addAnother() {
    const c = await sb();
    const { data } = await c.auth.getSession();
    rememberSession(data.session);
    try {
      if (data.session) localStorage.setItem(RETURN, data.session.user.id);
      localStorage.removeItem(c.auth.storageKey);
    } catch {}
    location.reload();
  },
};

export const auth = {
  async getUser() {
    if (!isCloud) { uid = 'local'; return LOCAL_USER; }
    const c = await sb();
    const { data } = await c.auth.getSession();
    uid = data.session?.user?.id || null;
    rememberSession(data.session);
    return data.session?.user || null;
  },
  onChange(cb) {
    if (!isCloud) return () => {};
    let sub;
    sb().then((c) => {
      sub = c.auth.onAuthStateChange((event, session) => {
        uid = session?.user?.id || null;
        if (session) rememberSession(session);
        cb(session?.user || null, event);
      }).data.subscription;
    });
    return () => sub?.unsubscribe();
  },
  async signIn(email, password) {
    const c = await sb();
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    accounts.clearReturn();
  },
  async signUp(email, password) {
    const c = await sb();
    const { data, error } = await c.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } });
    if (error) throw error;
    return data;
  },
  async signOut() {
    if (!isCloud) return;
    const c = await sb();
    const { data } = await c.auth.getSession();
    if (data.session) accounts.forget(data.session.user.id);
    await c.auth.signOut({ scope: 'local' }); // solo este dispositivo
  },
  async resetPassword(email) {
    const c = await sb();
    const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
    if (error) throw error;
  },
  async updatePassword(password) {
    const c = await sb();
    const { error } = await c.auth.updateUser({ password });
    if (error) throw error;
  },
};

// ---------- modo local ----------
const LS = 'prime:';
const lsGet = (t) => { try { return JSON.parse(localStorage.getItem(LS + t)) || []; } catch { return []; } };
const lsSet = (t, rows) => localStorage.setItem(LS + t, JSON.stringify(rows));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

function matches(row, q) {
  for (const [k, v] of Object.entries(q.eq || {})) if (row[k] !== v) return false;
  for (const [k, v] of Object.entries(q.gte || {})) if (!(row[k] >= v)) return false;
  for (const [k, v] of Object.entries(q.lte || {})) if (!(row[k] <= v)) return false;
  for (const [k, v] of Object.entries(q.in || {})) if (!v.includes(row[k])) return false;
  return true;
}

const local = {
  async list(t, q = {}) {
    let rows = lsGet(t).filter((r) => matches(r, q));
    if (q.order) {
      const dir = q.asc ? 1 : -1;
      rows.sort((a, b) => (a[q.order] > b[q.order] ? 1 : a[q.order] < b[q.order] ? -1 : 0) * dir);
    }
    return q.limit ? rows.slice(0, q.limit) : rows;
  },
  async insert(t, row) {
    const rows = lsGet(t);
    const r = { id: newId(), created_at: new Date().toISOString(), ...row, user_id: 'local' };
    rows.push(r); lsSet(t, rows);
    return r;
  },
  async insertMany(t, list) {
    const out = [];
    for (const r of list) out.push(await local.insert(t, r));
    return out;
  },
  async update(t, id, patch) {
    const rows = lsGet(t);
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw new Error('No encontrado');
    rows[i] = { ...rows[i], ...patch }; lsSet(t, rows);
    return rows[i];
  },
  async remove(t, id) { lsSet(t, lsGet(t).filter((r) => r.id !== id)); },
  async removeWhere(t, q) { lsSet(t, lsGet(t).filter((r) => !matches(r, q))); },
  async upsert(t, row, onConflict = 'id') {
    const keys = onConflict.split(',');
    const full = { ...row, user_id: 'local' };
    const rows = lsGet(t);
    const i = rows.findIndex((r) => keys.every((k) => r[k] === full[k]));
    if (i >= 0) { rows[i] = { ...rows[i], ...full }; lsSet(t, rows); return rows[i]; }
    return local.insert(t, full);
  },
  async getProfile() { try { return JSON.parse(localStorage.getItem(LS + 'profile')); } catch { return null; } },
  async saveProfile(data) { localStorage.setItem(LS + 'profile', JSON.stringify(data)); },
};

// ---------- Supabase ----------
function applyQuery(qb, q) {
  for (const [k, v] of Object.entries(q.eq || {})) qb = qb.eq(k, v);
  for (const [k, v] of Object.entries(q.gte || {})) qb = qb.gte(k, v);
  for (const [k, v] of Object.entries(q.lte || {})) qb = qb.lte(k, v);
  for (const [k, v] of Object.entries(q.in || {})) qb = qb.in(k, v);
  return qb;
}
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const cloud = {
  async list(t, q = {}) {
    const c = await sb();
    let qb = applyQuery(c.from(t).select('*'), q);
    if (q.order) qb = qb.order(q.order, { ascending: !!q.asc });
    if (q.limit) qb = qb.limit(q.limit);
    return ok(await qb);
  },
  async insert(t, row) {
    const c = await sb();
    return ok(await c.from(t).insert({ ...row, user_id: uid }).select().single());
  },
  async insertMany(t, list) {
    if (!list.length) return [];
    const c = await sb();
    return ok(await c.from(t).insert(list.map((r) => ({ ...r, user_id: uid }))).select());
  },
  async update(t, id, patch) {
    const c = await sb();
    return ok(await c.from(t).update(patch).eq('id', id).select().single());
  },
  async remove(t, id) {
    const c = await sb();
    ok(await c.from(t).delete().eq('id', id));
  },
  async removeWhere(t, q) {
    const c = await sb();
    ok(await applyQuery(c.from(t).delete(), q));
  },
  async upsert(t, row, onConflict = 'id') {
    const c = await sb();
    return ok(await c.from(t).upsert({ ...row, user_id: uid }, { onConflict }).select().single());
  },
  async getProfile() {
    const c = await sb();
    const data = ok(await c.from('profiles').select('data').eq('id', uid).maybeSingle());
    return data?.data || null;
  },
  async saveProfile(data) {
    const c = await sb();
    ok(await c.from('profiles').upsert({ id: uid, data, updated_at: new Date().toISOString() }));
  },
};

export const db = isCloud ? cloud : local;

export const TABLES = ['foods', 'diary', 'recipes', 'weights', 'plans', 'days'];

export async function exportAll() {
  const out = { version: 1, exported_at: new Date().toISOString(), profile: await db.getProfile() };
  for (const t of TABLES) out[t] = await db.list(t, {});
  return out;
}

export async function importAll(json) {
  if (json.profile) await db.saveProfile(json.profile);
  for (const t of TABLES) {
    for (const r of json[t] || []) {
      const { user_id, ...rest } = r;
      await db.upsert(t, rest, 'id');
    }
  }
}

// Llamadas a funciones SQL (IA compartida, invitaciones). En modo local no hay servidor.
export async function rpc(fn, args = {}) {
  if (!isCloud) return null;
  const c = await sb();
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function getAccessToken() {
  if (!isCloud) return null;
  const c = await sb();
  const { data } = await c.auth.getSession();
  return data.session?.access_token || null;
}

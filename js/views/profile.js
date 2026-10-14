import { html, useState, useMemo, useEffect } from '../lib.js';
import { isCloud, auth, db, exportAll, importAll, accounts } from '../store.js';
import { legacyToRows, isLegacyBackup, PLAN_START, engineOf, planName } from '../gym-data.js';
import { PlanWizard } from './gym.js';
import { NoAiKey } from './ai-log.js';
import { biometricAvailable, lockEnabled, enableLock, disableLock, biometricName } from '../lock.js';
import { useApp, num } from '../util.js';
import { ACTIVITY, GOALS, MEALS, computeTargets, defaultProteinPerKg } from '../nutrition.js';
import { DEFAULT_MODEL } from '../ai.js';
import { Icon, Field, Segmented } from '../components.js';

export function ProfileView({ onboarding }) {
  const app = useApp();
  const [p, setP] = useState(() => ({ sex: 'm', activity: 'mod', goal: 'cut', mealShares: {}, manual: {}, ...app.profile }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setP({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setNested = (obj, k) => (e) => setP({ ...p, [obj]: { ...(p[obj] || {}), [k]: e.target.value } });
  const t = useMemo(() => computeTargets(p), [p]);
  const shareSum = MEALS.reduce((a, m) => a + (p.mealShares?.[m.id] !== undefined && p.mealShares[m.id] !== '' ? num(p.mealShares[m.id]) : m.share), 0);

  const save = async () => {
    if (!computeTargets(p)) return app.toast('Completá sexo, fecha de nacimiento, altura y peso', 'error');
    setBusy(true);
    // Lo que se cambia en otras pantallas (plan, lista de compras) no se pisa con datos viejos del formulario.
    const cur = app.profile || {};
    const merged = { ...p, plan: cur.plan ?? p.plan, gym: { ...(cur.gym || {}), ...(p.gym || {}), compras: cur.gym?.compras ?? p.gym?.compras } };
    try {
      await app.saveProfile(merged);
      if (p.name && app.user?.id) accounts.setName(app.user.id, p.name);
      app.toast('Perfil guardado ✓');
      if (onboarding) app.setTab(merged.plan || merged.gym?.firstGuardia ? 'hoy' : 'gym');
    } catch (e) { app.toast(e.message, 'error'); }
    setBusy(false);
  };

  const doExport = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `prime-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  };
  const [importing, setImporting] = useState(false);
  const doImport = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    file.text().then(async (txt) => {
      setImporting(true);
      try {
        const json = JSON.parse(txt);
        if (isLegacyBackup(json)) {
          const { days, weights, settings } = legacyToRows(json);
          for (const d of days) await db.upsert('days', d, 'user_id,date');
          for (const w of weights) await db.upsert('weights', w, 'user_id,date');
          const last = [...weights].sort((a, b) => (a.date > b.date ? 1 : -1)).at(-1);
          const np = { ...p, gym: { ...(p.gym || {}), ...settings } };
          if (last) np.weight = last.kg;
          if (!num(np.primeWeight)) np.primeWeight = 80;
          if (!np.useManual) { np.useManual = true; np.manual = { kcal: 2250, protein: 175, carbs: 240, fat: 65 }; }
          setP(np);
          await app.saveProfile(np);
          await app.loadDays();
          app.bump();
          app.toast(`Respaldo importado ✓ ${days.length} días y ${weights.length} pesos`);
        } else {
          await importAll(json);
          app.toast('Datos importados ✓');
          location.reload();
        }
      } catch (err) { app.toast('Archivo inválido: ' + err.message, 'error'); }
      setImporting(false);
    });
  };

  useEffect(() => { app.refreshAi?.(); }, []);
  const [bio, setBio] = useState({ avail: false, on: lockEnabled() });
  useEffect(() => { biometricAvailable().then((avail) => setBio((b) => ({ ...b, avail }))); }, []);
  const toggleBio = async () => {
    try {
      if (bio.on) { disableLock(); setBio({ ...bio, on: false }); app.toast('Bloqueo desactivado'); }
      else { await enableLock(app.user); setBio({ ...bio, on: true }); app.toast(`${biometricName()} activado ✓`); }
    } catch (e) { app.toast(e.name === 'NotAllowedError' ? 'Cancelado' : e.message, 'error'); }
  };
  const setGym = (k) => (e) => setP({ ...p, gym: { ...(p.gym || {}), [k]: e.target.value } });

  return html`
    <div class="view">
      ${onboarding && isCloud && html`<${OnboardingExit} />`}
      ${onboarding ? html`<div class="hero"><h1>¡Bienvenido a Prime! 💪</h1><p class="muted">Cargá tus datos y calculo tus calorías y macros para volver a tu mejor versión.</p></div>`
        : html`<h1 class="view-title">Perfil</h1>`}


      <section class="card stack">
        <h3>Tus datos</h3>
        <${Field} label="Nombre"><input value=${p.name || ''} onInput=${set('name')} /><//>
        <${Field} label="Sexo"><${Segmented} value=${p.sex} onChange=${(v) => setP({ ...p, sex: v })} options=${[{ id: 'm', label: 'Hombre' }, { id: 'f', label: 'Mujer' }]} /><//>
        <div class="grid2">
          <${Field} label="Fecha de nacimiento"><input type="date" value=${p.birthdate || ''} onInput=${set('birthdate')} /><//>
          <${Field} label="Altura (cm)"><input type="number" inputmode="decimal" value=${p.height || ''} onInput=${set('height')} /><//>
          <${Field} label="Peso actual (kg)"><input type="number" inputmode="decimal" step="0.1" value=${p.weight || ''} onInput=${set('weight')} /><//>
          <${Field} label="% grasa (opcional)"><input type="number" inputmode="decimal" step="0.1" value=${p.bodyfat || ''} onInput=${set('bodyfat')} /><//>
        </div>
        <${Field} label="Actividad"><select value=${p.activity} onChange=${set('activity')}>${ACTIVITY.map((a) => html`<option value=${a.id}>${a.label}</option>`)}</select><//>
        <${Field} label="Objetivo"><select value=${p.goal} onChange=${set('goal')}>${GOALS.map((g) => html`<option value=${g.id}>${g.label}</option>`)}</select><//>
      </section>

      <section class="card stack prime">
        <div class="prime-head"><${Icon} name="trophy" /><h3>Mi Prime</h3></div>
        <p class="muted small">Tu mejor versión: la app calcula cuánto falta, a qué ritmo y la fecha estimada.</p>
        <div class="grid2">
          <${Field} label="Peso prime (kg)"><input type="number" inputmode="decimal" step="0.1" value=${p.primeWeight || ''} onInput=${set('primeWeight')} /><//>
          <${Field} label="% grasa prime"><input type="number" inputmode="decimal" step="0.1" value=${p.primeBodyfat || ''} onInput=${set('primeBodyfat')} /><//>
        </div>
        <${Field} label="Fecha objetivo (opcional)"><input type="date" value=${p.primeDate || ''} onInput=${set('primeDate')} /><//>
        <${Field} label="Notas del plan prime" hint="Rutina, hábitos, lo que te funcionó en tu mejor momento…"><textarea rows="4" value=${p.primeNotes || ''} onInput=${set('primeNotes')}></textarea><//>
      </section>

      ${t && html`
        <section class="card stack targets">
          <h3>Tus objetivos diarios</h3>
          <div class="target-kcal"><b>${t.kcal}</b> kcal</div>
          <div class="macro-grid">
            <div class="mg p"><b>${t.protein} g</b><span>Proteína</span></div>
            <div class="mg c"><b>${t.carbs} g</b><span>Carbos</span></div>
            <div class="mg f"><b>${t.fat} g</b><span>Grasa</span></div>
            <div class="mg"><b>${t.fiber} g</b><span>Fibra</span></div>
          </div>
          <p class="muted small">Metabolismo basal ${t.bmr} kcal (${t.method}) × ${t.activity.f} actividad = mantenimiento <b>${t.tdee} kcal</b>. ${t.delta ? `Ajuste por objetivo: ${t.delta > 0 ? '+' : ''}${t.delta} kcal.` : ''} Proteína ${t.ppk} g/kg sobre ${t.refW} kg. Agua ≈ ${(t.water / 1000).toFixed(1)} L.</p>
          ${t.prime?.weeks && html`<p class="small">🏆 Llegás a tu prime en ~${Math.round(t.prime.weeks)} semanas (${t.prime.eta.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}).</p>`}
          ${t.warnings.map((w) => html`<p class="small warn">⚠️ ${w}</p>`)}
          <details>
            <summary>Ajustes avanzados</summary>
            <div class="stack pad-top">
              <div class="grid2">
                <${Field} label="Proteína (g/kg)"><input type="number" inputmode="decimal" step="0.1" value=${p.proteinPerKg || ''} placeholder=${defaultProteinPerKg(p.goal)} onInput=${set('proteinPerKg')} /><//>
                <${Field} label="Grasa (g/kg)"><input type="number" inputmode="decimal" step="0.1" value=${p.fatPerKg || ''} placeholder="0.8" onInput=${set('fatPerKg')} /><//>
              </div>
              <label class="check"><input type="checkbox" checked=${!!p.useManual} onChange=${set('useManual')} /> Usar objetivos manuales (ej: los que te dio tu nutricionista)</label>
              ${p.useManual && html`<div class="grid2">
                <${Field} label="Calorías"><input type="number" value=${p.manual?.kcal || ''} onInput=${setNested('manual', 'kcal')} /><//>
                <${Field} label="Proteína (g)"><input type="number" value=${p.manual?.protein || ''} onInput=${setNested('manual', 'protein')} /><//>
                <${Field} label="Carbos (g)"><input type="number" value=${p.manual?.carbs || ''} placeholder="auto" onInput=${setNested('manual', 'carbs')} /><//>
                <${Field} label="Grasa (g)"><input type="number" value=${p.manual?.fat || ''} onInput=${setNested('manual', 'fat')} /><//>
              </div>`}
            </div>
          </details>
        </section>`}

      <section class="card stack">
        <h3>Distribución por comida</h3>
        <p class="muted small">Porcentaje de las calorías diarias para cada comida (lo usa el plan automático). Total: <b class=${shareSum === 100 ? '' : 'warn'}>${shareSum}%</b></p>
        <div class="grid3">${MEALS.map((m) => html`<${Field} label=${m.label}><input type="number" inputmode="numeric" value=${p.mealShares?.[m.id] ?? m.share} onInput=${setNested('mealShares', m.id)} /><//>`)}</div>
        <${Field} label="Alimentos a excluir del plan" hint="Separados por coma. Ej: salmón, lentejas, leche"><input value=${p.planExclude || ''} onInput=${set('planExclude')} /><//>
        <${Field} label="Preferencias para el plan con IA" hint="Ej: sin lactosa, comidas rápidas, entreno a la tarde"><textarea rows="2" value=${p.planNotes || ''} onInput=${set('planNotes')}></textarea><//>
      </section>

      ${!onboarding && html`<section class="card stack">
        <h3><${Icon} name="dumbbell" size=${18} /> Plan de entrenamiento</h3>
        ${engineOf(app.H) === 'weekly' && html`<p class="small">Plan actual: <b>${planName(app.H)}</b> (armado con IA).</p>`}
        ${(engineOf(app.H) === 'guardia' || p.gym?.firstGuardia) && html`
          <p class="muted small">Rotación 24x48: guardia, franco 1, franco 2. Cambia el checklist, la rutina y qué comer cada día.</p>
          <div class="grid2">
            <${Field} label="Una fecha de guardia"><input type="date" value=${p.gym?.firstGuardia || ''} onInput=${setGym('firstGuardia')} /><//>
            <${Field} label="Inicio del plan"><input type="date" value=${p.gym?.planStart || PLAN_START} onInput=${setGym('planStart')} /><//>
          </div>`}
        <button class="btn ghost small" onClick=${() => app.openSheet(html`<${PlanWizard} onDone=${() => app.closeSheet()} />`, 'Armar plan con IA')}>
          <${Icon} name="sparkles" size=${16} /> ${engineOf(app.H) ? 'Rehacer mi plan con IA' : 'Armar mi plan con IA'}</button>
        ${engineOf(app.H) === 'weekly' && app.profile.gym?.firstGuardia && html`<button class="link-btn" onClick=${() => { const { plan, ...rest } = app.profile; app.saveProfile(rest); }}>Volver al sistema de guardias</button>`}
      </section>`}

      <section class="card stack">
        <h3><${Icon} name="sparkles" size=${18} /> Inteligencia artificial (gratis)</h3>
        ${app.aiStatus?.member && !(p.geminiKey || '').trim() && html`<div class="ai-meter">
          <div class="water-head"><b class="small">IA compartida activa</b><span class="small muted">${app.aiStatus.used} / ${app.aiStatus.limit} hoy</span></div>
          <div class="bar"><div style=${{ width: Math.min(100, (app.aiStatus.used / app.aiStatus.limit) * 100) + '%', background: 'var(--accent)' }}></div></div>
          <p class="small muted">No necesitás key propia. Se renueva cada día.</p>
        </div>`}
        ${isCloud && !app.aiStatus?.member && html`<${NoAiKey} />`}
        <p class="muted small">${app.aiStatus?.member ? 'Opcional: si cargás tu propia key, usás tu cuota y no tenés límite diario. ' : ''}Registro por foto/texto, importar recetas y planes con IA usan Google Gemini. Creá tu API key gratis en <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a>. ${isCloud ? 'Se guarda en tu cuenta (solo vos podés leerla).' : ''}</p>
        <${Field} label="API key de Gemini"><input type="password" autocomplete="off" value=${p.geminiKey || ''} onInput=${set('geminiKey')} placeholder="AIza…" /><//>
        <${Field} label="Modelo" hint="Si Google lo renombra, cambialo acá"><input value=${p.aiModel || ''} placeholder=${DEFAULT_MODEL} onInput=${set('aiModel')} /><//>
        <${Field} label="API key USDA (opcional)" hint="Gratis en fdc.nal.usda.gov/api-key-signup. Sin ella se usa DEMO_KEY (limitada)."><input type="password" autocomplete="off" value=${p.usdaKey || ''} onInput=${set('usdaKey')} /><//>
      </section>

      <button class="btn primary sticky-save" disabled=${busy} onClick=${save}>${onboarding ? 'Calcular y empezar' : 'Guardar perfil'}</button>

      ${!onboarding && html`
        <section class="card stack">
          <h3>Cuenta y datos</h3>
          <p class="small muted">Podés exportar un backup de todos tus datos o importar uno.</p>
          <p class="small">${isCloud ? html`Conectado como <b>${app.user?.email}</b>. Tus datos se sincronizan en todos tus dispositivos.` : html`<b>Modo local:</b> los datos quedan solo en este navegador. Configurá Supabase (ver README) para tener login y sincronización.`}</p>
          <div class="grid2">
            <button class="btn ghost small" onClick=${doExport}><${Icon} name="download" size=${16} /> Exportar backup</button>
            <label class="btn ghost small"><${Icon} name="upload" size=${16} /> ${importing ? 'Importando…' : 'Importar'}<input type="file" accept="application/json,.json" hidden onChange=${doImport} /></label>
          </div>
          ${bio.avail && html`<label class="check"><input type="checkbox" checked=${bio.on} onChange=${toggleBio} /> Pedir ${biometricName()} al abrir la app en este dispositivo</label>`}
          ${!bio.avail && html`<p class="muted small">Face ID / Touch ID: disponible cuando abrís la app publicada (HTTPS) en iPhone o Mac.</p>`}
          ${isCloud && html`<${Accounts} />`}
          ${isCloud && html`<button class="btn danger ghost" onClick=${() => { disableLock(); auth.signOut(); }}>Cerrar sesión</button>`}
        </section>`}
    </div>`;
}

// Cuentas guardadas en este dispositivo: cambiar con un toque o sumar otra (ej. tu novia).
function Accounts() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const list = accounts.list();
  const others = list.filter((a) => a.id !== app.user?.id);
  const go = async (a) => {
    setBusy(true);
    try { app.closeAll(); await accounts.switchTo(a.id); app.setTab('hoy'); } catch (e) { app.toast(e.message, 'error'); }
    setBusy(false);
  };
  return html`<div class="stack">
    <b class="small">Cuentas en este dispositivo</b>
    ${others.map((a) => html`<button class="account-row" disabled=${busy} onClick=${() => go(a)}>
      <span class="avatar">${(a.name || a.email || '?')[0].toUpperCase()}</span>
      <span class="txt"><b>Cambiar a ${a.name || a.email.split('@')[0]}</b><small>${a.email}</small></span><${Icon} name="right" /></button>`)}
    <button class="btn ghost small" onClick=${() => confirm('Vas a poder entrar o crear otra cuenta. Esta queda guardada para volver con un toque. ¿Seguir?') && accounts.addAnother()}>
      <${Icon} name="plus" size=${16} /> Agregar otra cuenta</button>
    <p class="muted small">Cada cuenta tiene sus propios datos, plan, historial y chat: nunca se mezclan.</p>
  </div>`;
}

// En la bienvenida de una cuenta nueva: salida para volver a otra cuenta o cerrar sesión.
function OnboardingExit() {
  const app = useApp();
  const others = accounts.list().filter((a) => a.id !== app.user?.id);
  const back = accounts.returnTo() || others[0] || null;
  const [busy, setBusy] = useState(false);
  const go = async (a) => { setBusy(true); try { await accounts.switchTo(a.id); } catch (e) { app.toast(e.message, 'error'); setBusy(false); } };
  const logout = async () => { setBusy(true); disableLock(); await auth.signOut(); };
  return html`<div class="onb-exit">
    ${back && html`<button class="back-btn inline" disabled=${busy} onClick=${() => go(back)}><${Icon} name="left" size=${18} /> Volver a ${back.name || back.email.split('@')[0]}</button>`}
    <span class="small muted onb-who">${app.user?.email}</span>
    <button class="link-btn small" disabled=${busy} onClick=${logout}>Cerrar sesión</button>
  </div>`;
}

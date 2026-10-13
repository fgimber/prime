import { html, useState, useEffect } from '../lib.js';
import { db } from '../store.js';
import { useApp, isoDate, addDays, parseISO, num, r1 } from '../util.js';
import { Icon, Segmented, Spinner } from '../components.js';
import {
  dayType, runPlan, foodItems, trainItems, isChecked, status, streaks, lastDone, suggest, libresWeek, startOf,
  engineOf, hasPlan, routines, getRoutine, planName, isGymDay, dayLabel, tipsOf, routineExtras, aiPlanToPlan,
} from '../gym-data.js';
import { generateTrainingPlan, fileToBase64, hasAI } from '../ai.js';
import { NoAiKey } from './ai-log.js';

const WD = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const fmtLong = (k) => { const d = parseISO(k); return `${WD[d.getDay()]} ${d.getDate()} ${MES[d.getMonth()].slice(0, 3)}`; };

export function GymView() {
  const app = useApp();
  const [seg, setSeg] = useState('hoy');
  const [sel, setSel] = useState(isoDate());
  const goto = (k) => { setSel(k); setSeg('hoy'); scrollTo(0, 0); };
  if (!hasPlan(app.H)) return html`<div class="view"><h1 class="view-title d">Tu plan</h1><${PlanWizard} /></div>`;
  return html`
    <div class="view">
      <h1 class="view-title d">${planName(app.H)}</h1>
      <${Segmented} value=${seg} onChange=${setSeg} options=${[{ id: 'hoy', label: 'Día' }, { id: 'cal', label: 'Calendario' }, { id: 'rut', label: 'Rutinas' }]} />
      ${seg === 'hoy' && html`<${GymDay} sel=${sel} setSel=${setSel} />`}
      ${seg === 'cal' && html`<${Calendar} sel=${sel} onPick=${goto} />`}
      ${seg === 'rut' && html`<${Routines} />`}
    </div>`;
}

export function RotationSetup({ inline }) {
  const app = useApp();
  const [v, setV] = useState(app.H.settings.firstGuardia || addDays(isoDate(), 1));
  const save = async () => {
    if (!v) return;
    await app.saveProfile({ ...app.profile, gym: { ...(app.profile.gym || {}), firstGuardia: v } });
    app.toast('Rotación guardada ✓');
  };
  return html`<section class=${'card stack' + (inline ? '' : ' accent-card')}>
    <h3 class="d big">¿Cuándo es tu próxima guardia?</h3>
    <p class="muted small">Con esa fecha se arma sola tu rotación de 24x48: guardia, franco 1 y franco 2.</p>
    <input type="date" value=${v} onInput=${(e) => setV(e.target.value)} />
    <button class="btn primary" onClick=${save}>Guardar rotación</button>
  </section>`;
}

// Asistente: la IA arma el plan de entrenamiento + comida a partir de la rutina.
export function PlanWizard({ onDone }) {
  const app = useApp();
  const [f, setF] = useState({ routine: '', schedule: '', food: '', goalText: '' });
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (!hasAI(app.profile)) return html`<section class="card stack"><p>Para que la IA arme tu plan, primero activá la IA gratis:</p><${NoAiKey} /></section>`;

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) { try { setPhoto(await fileToBase64(file, 1400)); } catch (err) { app.toast(err.message, 'error'); } }
  };
  const run = async () => {
    if (!f.routine.trim() && !photo && !f.goalText.trim()) return app.toast('Pegá tu rutina, sacale una foto o contá tu objetivo', 'error');
    setBusy(true);
    try {
      const out = await generateTrainingPlan(app.profile, app.targets, { ...f, photo });
      setPreview(aiPlanToPlan(out));
    } catch (e) { app.toast(e.message, 'error'); }
    setBusy(false);
  };
  const save = async () => {
    await app.saveProfile({ ...app.profile, plan: preview, gym: { ...(app.profile.gym || {}), planStart: isoDate() } });
    app.toast('¡Plan listo! 💪');
    onDone?.();
  };

  if (preview) return html`
    <section class="card stack accent-card pop-in">
      <h3 class="d big">${preview.name}</h3>
      <div class="week-strip">${preview.week.map((w, i) => html`<div class=${'wk-day ' + w.kind}><b>${WD[i]}</b><span>${w.label}</span></div>`)}</div>
      <p class="small muted">${preview.routines.length} rutinas · ${preview.meals.reduce((a, m) => a + m.options.length, 0)} opciones de comida · ${preview.shopping.length} grupos de compras</p>
      ${preview.routines.map((r) => html`<details><summary>${r.name}${r.full ? ' · ' + r.full : ''}</summary><${ExList} ex=${r.ex} /></details>`)}
      <div class="grid2"><button class="btn ghost" onClick=${() => setPreview(null)}>Ajustar</button><button class="btn primary" onClick=${save}>Usar este plan</button></div>
    </section>`;

  return html`
    <section class="card stack">
      <div class="wizard-head"><span class="coach-avatar"><${Icon} name="sparkles" size=${20} /></span>
        <div><b>La IA arma tu semana</b><p class="small muted">Pasale tu rutina y en ~30 segundos organiza cada día: qué entrenar, qué comer, compras y hábitos.</p></div></div>
      <label class="field"><span class="field-label">Tu rutina</span>
        <textarea rows="6" placeholder=${'Pegá la rutina tal cual te la dieron. Ej:\nDía 1 glúteos: hip thrust 4x10, búlgaras 3x12…\nDía 2 tren superior: …'} value=${f.routine} onInput=${set('routine')}></textarea></label>
      <label class="btn ghost small"><${Icon} name="camera" size=${16} /> ${photo ? 'Foto cargada ✓ (cambiar)' : 'O subí una foto de la rutina'}<input type="file" accept="image/*" hidden onChange=${pick} /></label>
      <label class="field"><span class="field-label">Días y horarios</span>
        <input placeholder="Ej: entreno lun, mar, jue y vie a la tarde; trabajo 9 a 18" value=${f.schedule} onInput=${set('schedule')} /></label>
      <label class="field"><span class="field-label">Comidas y gustos</span>
        <input placeholder="Ej: no como pescado, me gusta lo dulce, poco tiempo para cocinar" value=${f.food} onInput=${set('food')} /></label>
      <label class="field"><span class="field-label">Objetivo</span>
        <input placeholder="Ej: tonificar y bajar 4 kg sin perder fuerza" value=${f.goalText} onInput=${set('goalText')} /></label>
      <button class="btn primary big" disabled=${busy} onClick=${run}><${Icon} name="sparkles" size=${18} /> ${busy ? 'Armando tu plan…' : 'Armar mi plan'}</button>
      ${busy && html`<${Spinner} label="Organizando entrenamientos, comidas y compras…" />`}
    </section>`;
}

function Check({ on, half, title, sub, onClick }) {
  return html`<button class=${'check-item' + (on ? ' on' : '') + (half ? ' half' : '')} onClick=${onClick} aria-pressed=${!!on}>
    <span class="box"><${Icon} name="check" size=${16} /></span>
    <span class="txt"><b>${title}</b>${sub && html`<small>${sub}</small>`}</span>
  </button>`;
}

const ExList = ({ ex }) => html`<ul class="exlist">${ex.map((e) => (Array.isArray(e) ? html`<li><span>${e[0]}</span>${e[1] && html`<span>${e[1]}</span>`}</li>` : html`<li><span>${e}</span></li>`))}</ul>`;

function GymDay({ sel: k, setSel }) {
  const app = useApp();
  const { H, updateDay } = app;
  const tk = isoDate();
  const guardia = engineOf(H) === 'guardia';
  const t = dayType(k, H);
  const st = streaks(H);
  const d = H.days[k] || { c: {} };
  const [peso, setPeso] = useState('');
  const [pesoId, setPesoId] = useState(null);

  useEffect(() => {
    setPeso('');
    db.list('weights', { eq: { date: k } }).then((r) => { setPeso(r[0] ? String(r[0].kg) : ''); setPesoId(r[0]?.id || null); }).catch(() => {});
  }, [k, app.version]);

  const savePeso = async () => {
    const v = num(peso);
    try {
      if (!v) { if (pesoId) { await db.remove('weights', pesoId); setPesoId(null); } return; }
      const row = await db.upsert('weights', { date: k, kg: r1(v) }, 'user_id,date');
      setPesoId(row.id);
      if (k >= tk) await app.saveProfile({ ...app.profile, weight: r1(v) });
      app.toast('Peso guardado ✓');
    } catch (e) { app.toast(e.message, 'error'); }
  };

  const tog = (key) => updateDay(k, (x) => {
    if (key === 'limpia' && x.libre) { x.libre = false; x.c.limpia = false; }
    else if (key === 'agua') { x.c.agua = !isChecked(x, 'agua'); }
    else x.c[key] = !x.c[key];
    return x;
  });
  const set = (fn) => updateDay(k, (x) => { fn(x); return x; });

  const useLibre = () => {
    set((x) => { x.libre = true; x.c.limpia = true; });
    const n = libresWeek(k, { ...H, days: { ...H.days, [k]: { ...d, libre: true } } });
    if (n > 1) app.toast(`Ya van ${n} comidas libres esta semana. El plan es una.`, 'error');
  };

  const item = (i) => {
    const on = isChecked(d, i.k);
    if (guardia && i.k === 'pasos' && d.run) {
      const rp = runPlan(k, H);
      return html`<${Check} on=${on} title=${`Running · ${rp.m + 10} min`} sub=${`Semana ${rp.w} · ${rp.m} min de trote`} onClick=${() => tog('pasos')} />
        <div class="sub-card"><${ExList} ex=${rp.steps} /><p class="small muted">Ritmo de charla: tenés que poder hablar en frases cortas. No corras el día antes de pierna ni el día antes del torneo.</p>
        <div class="right"><button class="link-btn" onClick=${() => set((x) => { x.run = false; })}>Volver a pasos</button></div></div>`;
    }
    if (guardia && i.k === 'pasos' && !on) {
      return html`<${Check} title=${i.t} onClick=${() => tog('pasos')} /><div class="right"><button class="link-btn" onClick=${() => set((x) => { x.run = true; })}>Hoy corro en vez de caminar</button></div>`;
    }
    if (guardia && i.k === 'tuppers' && d.planb) {
      return html`<${Check} half title="Plan B activado" sub="Tocá para deshacer" onClick=${() => set((x) => { x.planb = false; x.c.tuppers = false; })} />
        <div class="sub-card"><${ExList} ex=${[['1. Freezer', 'Sacá 2 tuppers ahora'], ['2. Kit de guardia', 'Atún, huevos duros, pan, fruta'], ['3. Último recurso', 'Spiedo + ensalada']]} />
        <p class="small muted">Los huevos duros se hacen en 10 min mientras te bañás. Nada de facturas ni empanadas.</p></div>`;
    }
    if (guardia && i.k === 'tuppers' && !on) {
      return html`<${Check} title=${i.t} sub=${i.s} onClick=${() => tog('tuppers')} /><div class="right"><button class="link-btn" onClick=${() => set((x) => { x.planb = true; x.c.tuppers = true; })}>Hoy no puedo cocinar</button></div>`;
    }
    if (i.k === 'limpia' && d.libre) {
      return html`<${Check} half title="Comida libre usada" sub=${`${libresWeek(k, H)} esta semana · tocá para deshacer`} onClick=${() => tog('limpia')} />`;
    }
    return html`<${Check} on=${on} title=${i.t} sub=${i.s} onClick=${() => tog(i.k)} />
      ${i.k === 'limpia' && !on && html`<div class="right"><button class="link-btn" onClick=${useLibre}>Usé la comida libre</button></div>`}`;
  };

  const sg = suggest(k, H);
  const rKey = d.rut || sg.r;
  const r = getRoutine(H, rKey);
  const sgR = getRoutine(H, sg.r);
  const wdn = parseISO(k).getDay();
  const yesterdayMiss = k === tk && k > startOf(H) && status(addDays(k, -1), H) === 'miss';
  const gymDay = isGymDay(k, H);

  return html`
    <div class="streak">
      <div class="num d">${st.cur}</div>
      <div class="lbl"><b>días sin negociar</b><span class="muted">Mejor racha: ${st.best}</span></div>
    </div>

    <div class="date-bar">
      <button class="icon-btn" onClick=${() => setSel(addDays(k, -1))} aria-label="Día anterior"><${Icon} name="left" /></button>
      <label class="date-label"><b class="d bigdate">${k === tk ? 'Hoy' : fmtLong(k)}</b>
        <div class="small"><span class=${'tag' + (t === 'G' || gymDay ? ' g' : '')}>${dayLabel(k, H)}</span> ${k === tk ? fmtLong(k) : ''}</div>
        <input type="date" value=${k} onChange=${(e) => e.target.value && setSel(e.target.value)} />
      </label>
      <button class="icon-btn" onClick=${() => setSel(addDays(k, 1))} aria-label="Día siguiente"><${Icon} name="right" /></button>
    </div>

    ${k < startOf(H) && html`<div class="alert info">El plan arranca el ${fmtLong(startOf(H))}.</div>`}
    ${yesterdayMiss && html`<div class="alert">Ayer no se cumplió. Nunca dos fallas seguidas: hoy es obligatorio.</div>`}
    ${guardia && wdn === 6 && html`<div class="alert info">Sábado de torneo: el partido cuenta como cardio.</div>`}

    <section class="group">
      <h2 class="group-title">Entrenamiento</h2>
      ${gymDay && r && html`
        <div class=${'gym-card' + (d.gym === 'full' ? ' on' : d.gym === 'min' ? ' half' : '')}>
          <div class="gym-ttl">Gym<small>${d.rut ? `${r.name}${r.full ? ' · ' + r.full : ''}` : `Toca ${sgR.name}${sgR.full ? ' · ' + sgR.full : ''}`}</small></div>
          <div class="rchips">${routines(H).map((x) => html`<button class=${'rchip d' + (x.key === r.key && d.rut ? ' sel' : '') + (x.key === sg.r ? ' sug' : '')} onClick=${() => set((y) => { y.rut = x.key; })}>${x.name}</button>`)}</div>
          <div class="grid2 acts">
            <button class=${'btn' + (d.gym === 'full' ? ' ok' : ' dark')} onClick=${() => set((y) => { y.gym = y.gym === 'full' ? null : 'full'; if (y.gym && !y.rut) y.rut = sg.r; })}>${d.gym === 'full' ? 'Hecho ✓' : 'Rutina completa'}</button>
            <button class=${'btn' + (d.gym === 'min' ? ' part' : '')} onClick=${() => set((y) => { y.gym = y.gym === 'min' ? null : 'min'; if (y.gym && !y.rut) y.rut = sg.r; })}>${d.gym === 'min' ? 'Mínima ✓' : 'Versión mínima'}</button>
          </div>
          ${sg.note && !d.rut && html`<p class="small muted">${sg.note}</p>`}
          ${guardia && wdn === 0 && !d.gym && html`<p class="small muted">Domingo: el gym está cerrado. Hacé running o el circuito en casa (está en Rutinas) y marcá Versión mínima.</p>`}
          <details><summary>Ver ejercicios de ${r.name}</summary><${ExList} ex=${r.ex} /></details>
        </div>`}
      ${trainItems(k, H).map(item)}
      ${!gymDay && !trainItems(k, H).length && html`<p class="muted small">Día de descanso: recuperá, dormí bien y movete suave.</p>`}
    </section>

    <section class="group">
      <h2 class="group-title">Comida${guardia ? ' · 4 comidas, proteína en todas' : ''}</h2>
      ${foodItems(k, H).map(item)}
      <button class="link-btn" onClick=${() => app.setTab('hoy')}><${Icon} name="utensils" size=${14} /> Registrar calorías en el diario</button>
    </section>

    <section class="group">
      <h2 class="group-title">Peso en ayunas</h2>
      <div class="weight-row">
        <label for="peso">Peso ${k === tk ? 'de hoy' : 'del día'}</label>
        <input id="peso" type="number" inputmode="decimal" step="0.1" min="30" max="250" placeholder="—" value=${peso}
          onInput=${(e) => setPeso(e.target.value)} onChange=${savePeso} />
        <span class="muted">kg</span>
      </div>
    </section>`;
}

function Calendar({ sel, onPick }) {
  const { H } = useApp();
  const [ym, setYm] = useState(() => { const d = parseISO(sel); return [d.getFullYear(), d.getMonth()]; });
  const [y, m] = ym;
  const first = new Date(y, m, 1), n = new Date(y, m + 1, 0).getDate();
  const off = (first.getDay() + 6) % 7;
  const tk = isoDate();
  const guardia = engineOf(H) === 'guardia';
  const move = (dlt) => { let mm = m + dlt, yy = y; if (mm < 0) { mm = 11; yy--; } if (mm > 11) { mm = 0; yy++; } setYm([yy, mm]); };
  const cells = [];
  for (let i = 0; i < off; i++) cells.push(html`<div class="cell empty"></div>`);
  for (let dd = 1; dd <= n; dd++) {
    const k = isoDate(new Date(y, m, dd));
    const s = status(k, H);
    const tag = guardia ? dayType(k, H) : (isGymDay(k, H) ? '●' : '');
    const c = s === 'ok' ? ' ok' : s === 'part' ? ' part' : s === 'miss' && k >= startOf(H) ? ' miss' : '';
    cells.push(html`<button class=${'cell' + c + (k === tk ? ' today' : '')} onClick=${() => onPick(k)} aria-label=${fmtLong(k)}>${dd}<span class="t">${tag}</span></button>`);
  }
  return html`
    <section class="card stack">
      <div class="date-bar">
        <button class="icon-btn" onClick=${() => move(-1)} aria-label="Mes anterior"><${Icon} name="left" /></button>
        <b class="d bigdate cap">${MES[m]} ${y}</b>
        <button class="icon-btn" onClick=${() => move(1)} aria-label="Mes siguiente"><${Icon} name="right" /></button>
      </div>
      <div class="cal">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((w) => html`<div class="wd">${w}</div>`)}${cells}</div>
      <div class="legend"><span><i class="lg ok"></i>Todo cumplido</span><span><i class="lg part"></i>Entrenó, faltó algo</span><span><i class="lg miss"></i>Fallado</span><span>${guardia ? 'G guardia · F1/F2 francos' : '● día de gym'}</span></div>
    </section>`;
}

function Routines() {
  const app = useApp();
  const { H } = app;
  const ld = lastDone(H);
  const today = isoDate() < startOf(H) ? startOf(H) : isoDate();
  const redo = () => app.openSheet(html`<${PlanWizard} onDone=${() => app.closeSheet()} />`, 'Rehacer plan con IA');
  return html`
    ${engineOf(H) === 'weekly' && html`<section class="card">
      <div class="week-strip">${H.plan.week.map((w, i) => html`<div class=${'wk-day ' + w.kind + (i === new Date().getDay() ? ' now' : '')}><b>${WD[i]}</b><span>${w.label}</span></div>`)}</div>
    </section>`}
    ${routines(H).map((r) => html`<section class="card">
      <h3 class="d big">${r.name}${r.full ? ' · ' + r.full : ''}</h3>
      <p class="small muted">${ld[r.key] ? 'Última vez: ' + fmtLong(ld[r.key]) : 'Todavía sin hacer'}</p>
      <${ExList} ex=${r.ex} />
    </section>`)}
    ${tipsOf(H) && html`<section class="card"><p class="small">${tipsOf(H)}</p></section>`}
    ${routineExtras(H, today).map((x) => html`<section class="card"><h3 class="d big">${x.title}</h3>${x.text && html`<p class="small muted">${x.text}</p>`}<${ExList} ex=${x.rows || []} /></section>`)}
    ${engineOf(H) === 'weekly' && html`<button class="btn ghost" onClick=${redo}><${Icon} name="sparkles" size=${16} /> Rehacer plan con IA</button>`}`;
}

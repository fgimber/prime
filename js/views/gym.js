import { html, useState, useEffect } from '../lib.js';
import { db } from '../store.js';
import { useApp, isoDate, addDays, parseISO, num, r1 } from '../util.js';
import { Icon, Segmented, Spinner, Field } from '../components.js';
import {
  dayType, runPlan, trainItems, isChecked, status, streaks, lastDone, suggest, startOf, lastLift,
  engineOf, hasPlan, routines, getRoutine, planName, isGymDay, dayLabel, tipsOf, routineExtras, aiPlanToPlan,
} from '../gym-data.js';
import { generateTrainingPlan, generateRoutines, fileToBase64, hasAI } from '../ai.js';
import { NoAiKey } from './ai-log.js';

const WD = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const fmtLong = (k) => { const d = parseISO(k); return `${WD[d.getDay()]} ${d.getDate()} ${MES[d.getMonth()].slice(0, 3)}`; };
const fmtKg = (v) => String(r1(v)).replace('.', ',');
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'rutina';
const uniqueKeys = (list) => { const seen = new Set(); return list.map((r) => { let k = r.key || slug(r.name); let i = 2; while (seen.has(k)) k = `${slug(r.name)}_${i++}`; seen.add(k); return { ...r, key: k }; }); };

// Guarda las rutinas en el lugar que corresponde a cada usuario (plan semanal o sistema propio).
async function saveRoutines(app, list) {
  const p = app.profile;
  const clean = uniqueKeys(list.map((r) => ({ ...r, ex: (r.ex || []).filter((e) => (e[0] || '').trim()) })).filter((r) => (r.name || '').trim()));
  if (engineOf(app.H) === 'weekly') {
    const keys = clean.map((r) => r.key);
    let i = 0;
    const week = (p.plan.week || []).map((w) => (w.kind === 'gym' ? { ...w, routine: keys.includes(w.routine) ? w.routine : keys[i++ % Math.max(1, keys.length)] || null } : w));
    await app.saveProfile({ ...p, plan: { ...p.plan, routines: clean, week } });
  } else {
    await app.saveProfile({ ...p, gym: { ...(p.gym || {}), routines: clean } });
  }
}

export function GymView() {
  const app = useApp();
  const [seg, setSeg] = useState('hoy');
  const [sel, setSel] = useState(isoDate());
  const goto = (k) => { setSel(k); setSeg('hoy'); scrollTo(0, 0); };
  if (!hasPlan(app.H)) return html`<div class="view"><h1 class="view-title d">Tu entrenamiento</h1><${PlanWizard} /></div>`;
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

const LEVELS = [{ id: 'principiante', label: 'Principiante' }, { id: 'intermedio', label: 'Intermedio' }, { id: 'avanzado', label: 'Avanzado' }];

// Asistente para la primera vez: la IA arma todo (entreno + comida + compras + hábitos),
// desde una rutina que ya tenés o desde cero con tus objetivos.
export function PlanWizard({ onDone }) {
  const app = useApp();
  const [mode, setMode] = useState('build');
  const [f, setF] = useState({ routine: '', schedule: '', food: '', goalText: '', days: '4', minutes: '60', level: 'intermedio', equipment: '' });
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (!hasAI(app.profile)) return html`<section class="card stack"><p>Para que la IA arme tu plan, primero activá la IA:</p><${NoAiKey} /></section>`;

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) { try { setPhoto(await fileToBase64(file, 1400)); } catch (err) { app.toast(err.message, 'error'); } }
  };
  const run = async () => {
    if (mode === 'have' && !f.routine.trim() && !photo) return app.toast('Pegá tu rutina o sacale una foto', 'error');
    if (mode === 'build' && !f.goalText.trim()) return app.toast('Contale a la IA tu objetivo', 'error');
    setBusy(true);
    try {
      const extra = mode === 'build'
        ? `${f.days} días de gym por semana, sesiones de ${f.minutes} min, nivel ${f.level}${f.equipment ? `, equipamiento: ${f.equipment}` : ''}.`
        : '';
      const out = await generateTrainingPlan(app.profile, app.targets, {
        routine: mode === 'have' ? f.routine : '', photo: mode === 'have' ? photo : null,
        schedule: [f.schedule, extra].filter(Boolean).join(' '), food: f.food, goalText: f.goalText,
      });
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
        <div><b>La IA arma tu semana</b><p class="small muted">Organiza cada día: qué entrenar, qué comer, compras y hábitos. Tarda unos 30 segundos.</p></div></div>
      <${Segmented} value=${mode} onChange=${setMode} options=${[{ id: 'build', label: 'Armámela' }, { id: 'have', label: 'Ya tengo rutina' }]} />
      ${mode === 'have' ? html`
        <label class="field"><span class="field-label">Tu rutina</span>
          <textarea rows="6" placeholder=${'Pegá la rutina tal cual te la dieron. Ej:\nDía 1 glúteos: hip thrust 4x10, búlgaras 3x12…\nDía 2 tren superior: …'} value=${f.routine} onInput=${set('routine')}></textarea></label>
        <label class="btn ghost small"><${Icon} name="camera" size=${16} /> ${photo ? 'Foto cargada ✓ (cambiar)' : 'O subí una foto de la rutina'}<input type="file" accept="image/*" hidden onChange=${pick} /></label>`
      : html`
        <div class="grid2">
          <${Field} label="Días de gym"><select value=${f.days} onChange=${set('days')}>${[2, 3, 4, 5, 6].map((n) => html`<option value=${n}>${n} por semana</option>`)}</select><//>
          <${Field} label="Tiempo"><select value=${f.minutes} onChange=${set('minutes')}>${[30, 45, 60, 75, 90].map((n) => html`<option value=${n}>${n} min</option>`)}</select><//>
        </div>
        <${Field} label="Nivel"><${Segmented} value=${f.level} onChange=${(v) => setF({ ...f, level: v })} options=${LEVELS} /><//>
        <${Field} label="Equipamiento"><input placeholder="Ej: gimnasio completo / solo mancuernas en casa" value=${f.equipment} onInput=${set('equipment')} /><//>`}
      <${Field} label="Objetivo"><input placeholder="Ej: tonificar y bajar 4 kg sin perder fuerza" value=${f.goalText} onInput=${set('goalText')} /><//>
      <${Field} label="Días y horarios"><input placeholder="Ej: entreno lun, mar, jue y vie a la tarde" value=${f.schedule} onInput=${set('schedule')} /><//>
      <${Field} label="Comidas y gustos"><input placeholder="Ej: no como pescado, poco tiempo para cocinar" value=${f.food} onInput=${set('food')} /><//>
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

// Un ejercicio con registro de peso y repeticiones; muestra lo de la última vez para mantener o subir.
function ExerciseLog({ k, ex, idx, routineKey }) {
  const app = useApp();
  const { H, updateDay } = app;
  const [name, sets] = ex;
  const cur = H.days[k]?.lifts?.[name] || {};
  const prev = lastLift(H, k, name);
  const [kg, setKg] = useState(cur.kg != null ? String(cur.kg) : '');
  const [reps, setReps] = useState(cur.reps != null ? String(cur.reps) : '');
  useEffect(() => { setKg(cur.kg != null ? String(cur.kg) : ''); setReps(cur.reps != null ? String(cur.reps) : ''); }, [k]);
  const save = (nkg, nreps) => updateDay(k, (x) => {
    const lifts = { ...(x.lifts || {}) };
    const v = { kg: num(nkg) || null, reps: num(nreps) || null };
    if (!v.kg && !v.reps) delete lifts[name]; else lifts[name] = v;
    x.lifts = lifts;
    if (!x.rut) x.rut = routineKey;
    return x;
  });
  const apply = (nkg, nreps) => { setKg(nkg); setReps(nreps); save(nkg, nreps); };
  const done = cur.kg || cur.reps;
  const up = prev?.kg && (num(kg) || 0) > prev.kg;
  return html`<div class=${'ex-row' + (done ? ' done' : '')}>
    <div class="ex-top">
      <span class="ex-n">${idx + 1}</span>
      <div class="ex-name"><b>${name}</b><small>${sets}</small></div>
      <div class="ex-in">
        <label><input type="number" inputmode="decimal" step="0.5" placeholder=${prev?.kg ? fmtKg(prev.kg) : '–'} value=${kg} onInput=${(e) => setKg(e.target.value)} onChange=${(e) => save(e.target.value, reps)} /><span>kg</span></label>
        <label><input type="number" inputmode="numeric" placeholder=${prev?.reps || '–'} value=${reps} onInput=${(e) => setReps(e.target.value)} onChange=${(e) => save(kg, e.target.value)} /><span>reps</span></label>
      </div>
    </div>
    ${prev && html`<div class="ex-prev">
      <span class="muted">Última: <b>${prev.kg ? fmtKg(prev.kg) + ' kg' : ''}${prev.kg && prev.reps ? ' × ' : ''}${prev.reps ? prev.reps : ''}</b> · ${fmtLong(prev.date)}</span>
      ${up && html`<span class="ex-up">▲ +${fmtKg(num(kg) - prev.kg)} kg</span>`}
      <span class="ex-actions">
        <button class="mini-btn" onClick=${() => apply(prev.kg ? String(prev.kg) : kg, prev.reps ? String(prev.reps) : reps)}>Mantener</button>
        ${prev.kg && html`<button class="mini-btn up" onClick=${() => apply(String(r1(prev.kg + 2.5)), prev.reps ? String(prev.reps) : reps)}>+2,5</button>`}
      </span>
    </div>`}
  </div>`;
}

// Ritmo "5:30" (min:seg por km) ↔ segundos.
const paceToSec = (v) => {
  const t = String(v || '').trim().replace(',', '.');
  if (!t) return 0;
  if (t.includes(':')) { const [m, s] = t.split(':'); return (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0); }
  return Math.round(parseFloat(t) * 60) || 0; // 5.5 = 5:30
};
const secToPace = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const secToTime = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };

// Running: cargás kilómetros y ritmo (min/km); calcula el tiempo y muestra tu última corrida.
function RunLog({ k, onBack }) {
  const app = useApp();
  const { H, updateDay } = app;
  const cur = H.days[k]?.runLog || {};
  const prev = Object.keys(H.days).filter((x) => x < k).sort().reverse().map((x) => ({ date: x, ...H.days[x]?.runLog })).find((r) => r.km);
  const [km, setKm] = useState(cur.km ? String(cur.km).replace('.', ',') : '');
  const [pace, setPace] = useState(cur.pace ? secToPace(cur.pace) : '');
  const kmN = num(km), paceS = paceToSec(pace);
  const total = kmN && paceS ? kmN * paceS : 0;
  const save = (nkm, npace) => updateDay(k, (x) => {
    const kmv = num(nkm), pv = paceToSec(npace);
    x.runLog = kmv || pv ? { km: kmv || null, pace: pv || null } : undefined;
    if (!x.runLog) delete x.runLog;
    if (kmv) x.c.pasos = true;
    return x;
  });
  const repeat = () => { const a = String(prev.km).replace('.', ','), b = secToPace(prev.pace); setKm(a); setPace(b); save(a, b); };
  return html`<div class=${'run-card' + (kmN ? ' done' : '')}>
    <div class="run-head">
      <div><span class="eyebrow">Running</span>
        <b class="d run-title">${kmN ? `${String(kmN).replace('.', ',')} km` : 'Hoy corro'}</b>
        ${total > 0 && html`<span class="muted small">${secToPace(paceS)} /km · ${secToTime(total)} en total</span>`}</div>
      <button class="link-btn small" onClick=${onBack}>Volver a pasos</button>
    </div>
    <div class="grid2">
      <label class="field"><span class="field-label">Distancia (km)</span>
        <input type="text" inputmode="decimal" placeholder=${prev?.km ? String(prev.km).replace('.', ',') : '3'} value=${km}
          onInput=${(e) => setKm(e.target.value)} onChange=${(e) => save(e.target.value, pace)} /></label>
      <label class="field"><span class="field-label">Ritmo (min/km)</span>
        <input type="text" inputmode="decimal" placeholder=${prev?.pace ? secToPace(prev.pace) : '5:30'} value=${pace}
          onInput=${(e) => setPace(e.target.value)} onChange=${(e) => save(km, e.target.value)} /></label>
    </div>
    ${prev && html`<div class="ex-prev run-prev">
      <span class="muted">Última: <b>${String(prev.km).replace('.', ',')} km${prev.pace ? ` a ${secToPace(prev.pace)}/km` : ''}</b> · ${fmtLong(prev.date)}</span>
      <span class="ex-actions"><button class="mini-btn" onClick=${repeat}>Igual que la última</button></span>
    </div>`}
    <p class="small muted">Ritmo en minutos y segundos por kilómetro, ej. 5:30. No corras el día antes de pierna ni el del torneo.</p>
  </div>`;
}

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

  const tog = (key) => updateDay(k, (x) => { x.c[key] = !x.c[key]; return x; });
  const set = (fn) => updateDay(k, (x) => { fn(x); return x; });

  const item = (i) => {
    const on = isChecked(d, i.k);
    if (guardia && i.k === 'pasos' && d.run) {
      return html`<${RunLog} k=${k} onBack=${() => set((x) => { x.run = false; })} />`;
    }
    if (guardia && i.k === 'pasos' && !on) {
      return html`<${Check} title=${i.t} onClick=${() => tog('pasos')} /><div class="right"><button class="link-btn" onClick=${() => set((x) => { x.run = true; })}>Hoy corro en vez de caminar</button></div>`;
    }
    if (guardia && i.k === 'tuppers' && d.planb) {
      return html`<${Check} half title="Plan B activado" sub="Tocá para deshacer" onClick=${() => set((x) => { x.planb = false; x.c.tuppers = false; })} />
        <div class="sub-card"><${ExList} ex=${[['1. Freezer', 'Sacá 2 tuppers ahora'], ['2. Kit de guardia', 'Atún, huevos duros, pan, fruta'], ['3. Último recurso', 'Spiedo + ensalada']]} /></div>`;
    }
    if (guardia && i.k === 'tuppers' && !on) {
      return html`<${Check} title=${i.t} sub=${i.s} onClick=${() => tog('tuppers')} /><div class="right"><button class="link-btn" onClick=${() => set((x) => { x.planb = true; x.c.tuppers = true; })}>Hoy no puedo cocinar</button></div>`;
    }
    return html`<${Check} on=${on} title=${i.t} sub=${i.s} onClick=${() => tog(i.k)} />`;
  };

  const sg = suggest(k, H);
  const rKey = d.rut || sg.r;
  const r = getRoutine(H, rKey);
  const sgR = getRoutine(H, sg.r);
  const wdn = parseISO(k).getDay();
  const yesterdayMiss = k === tk && k > startOf(H) && status(addDays(k, -1), H) === 'miss';
  const gymDay = isGymDay(k, H);
  const tasks = trainItems(k, H);
  const logged = r ? r.ex.filter((e) => d.lifts?.[e[0]]).length : 0;

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

    ${gymDay && r && html`
      <section class=${'train-card' + (d.gym === 'full' ? ' on' : d.gym === 'min' ? ' half' : '')}>
        <div class="train-head">
          <div>
            <span class="eyebrow">${d.rut ? 'Entrenamiento de hoy' : 'Te toca'}</span>
            <h2 class="d train-title">${r.name}</h2>
            ${r.full && html`<p class="muted small">${r.full}</p>`}
          </div>
          <div class="train-count"><b class="d">${logged}</b><span>/${r.ex.length}</span></div>
        </div>
        <div class="rchips">${routines(H).map((x) => html`<button class=${'rchip d' + (x.key === r.key && d.rut ? ' sel' : '') + (x.key === sg.r ? ' sug' : '')} onClick=${() => set((y) => { y.rut = x.key; })}>${x.name}</button>`)}</div>
        ${sg.note && !d.rut && html`<p class="small muted">${sg.note}</p>`}
        ${guardia && wdn === 0 && !d.gym && html`<p class="small muted">Domingo: el gym está cerrado. Hacé running o el circuito en casa (está en Rutinas) y marcá Versión mínima.</p>`}
        <div class="ex-list">${r.ex.map((e, i) => html`<${ExerciseLog} key=${k + r.key + i} k=${k} ex=${e} idx=${i} routineKey=${r.key} />`)}</div>
        <div class="grid2 acts">
          <button class=${'btn' + (d.gym === 'full' ? ' ok' : ' dark')} onClick=${() => set((y) => { y.gym = y.gym === 'full' ? null : 'full'; if (y.gym && !y.rut) y.rut = r.key; })}>${d.gym === 'full' ? 'Hecho ✓' : 'Rutina completa'}</button>
          <button class=${'btn' + (d.gym === 'min' ? ' part' : '')} onClick=${() => set((y) => { y.gym = y.gym === 'min' ? null : 'min'; if (y.gym && !y.rut) y.rut = r.key; })}>${d.gym === 'min' ? 'Mínima ✓' : 'Versión mínima'}</button>
        </div>
      </section>`}

    ${tasks.length > 0 && html`<section class="group">
      <h2 class="group-title">${gymDay ? 'Además, hoy' : 'Lo de hoy'}</h2>
      ${tasks.map(item)}
    </section>`}
    ${!gymDay && !tasks.length && html`<section class="card rest-card"><h3 class="d big">Día de descanso</h3><p class="small muted">Recuperá, dormí bien y movete suave. Mañana: ${dayLabel(addDays(k, 1), H)}.</p></section>`}

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
  const list = routines(H);
  const today = isoDate() < startOf(H) ? startOf(H) : isoDate();
  const weekly = engineOf(H) === 'weekly';
  const edit = (i) => app.openSheet(html`<${RoutineEditor} index=${i} />`, i == null ? 'Nueva rutina' : `Editar ${list[i].name}`);
  const ai = () => app.openSheet(html`<${RoutineAI} />`, 'Entrenador IA');
  const redo = () => app.openSheet(html`<${PlanWizard} onDone=${() => app.closeSheet()} />`, 'Rehacer plan con IA');
  return html`
    <section class="card trainer-cta">
      <div class="wizard-head"><span class="coach-avatar"><${Icon} name="sparkles" size=${20} /></span>
        <div><b>Entrenador IA</b><p class="small muted">Creá una rutina nueva según tus objetivos y tiempo, o pedile que mejore la tuya al mismo nivel o más avanzada.</p></div></div>
      <button class="btn primary" onClick=${ai}><${Icon} name="sparkles" size=${16} /> Crear o mejorar con IA</button>
    </section>
    ${weekly && html`<section class="card">
      <div class="week-strip">${H.plan.week.map((w, i) => html`<div class=${'wk-day ' + w.kind + (i === new Date().getDay() ? ' now' : '')}><b>${WD[i]}</b><span>${w.label}</span></div>`)}</div>
    </section>`}
    ${list.map((r, i) => html`<section class="card routine-card">
      <div class="routine-head">
        <div><h3 class="d big">${r.name}</h3>${r.full && html`<p class="small muted">${r.full}</p>`}</div>
        <button class="pill-btn" onClick=${() => edit(i)}><${Icon} name="edit" size=${14} /> Editar</button>
      </div>
      <p class="small muted">${ld[r.key] ? 'Última vez: ' + fmtLong(ld[r.key]) : 'Todavía sin hacer'}</p>
      <${ExList} ex=${r.ex} />
    </section>`)}
    <button class="btn ghost" onClick=${() => edit(null)}><${Icon} name="plus" size=${16} /> Agregar rutina a mano</button>
    ${tipsOf(H) && html`<section class="card"><p class="small">${tipsOf(H)}</p></section>`}
    ${routineExtras(H, today).map((x) => html`<section class="card"><h3 class="d big">${x.title}</h3>${x.text && html`<p class="small muted">${x.text}</p>`}<${ExList} ex=${x.rows || []} /></section>`)}
    ${weekly && html`<button class="btn ghost" onClick=${redo}><${Icon} name="refresh" size=${16} /> Rehacer plan completo con IA</button>`}`;
}

// Edición manual de una rutina, ejercicio por ejercicio.
function RoutineEditor({ index }) {
  const app = useApp();
  const list = routines(app.H);
  const orig = index != null ? list[index] : null;
  const [name, setName] = useState(orig?.name || '');
  const [full, setFull] = useState(orig?.full || '');
  const [ex, setEx] = useState(() => (orig?.ex?.length ? orig.ex.map((e) => [e[0], e[1] || '']) : [['', '']]));
  const [busy, setBusy] = useState(false);
  const setRow = (i, j, v) => setEx((cur) => cur.map((e, x) => (x === i ? (j === 0 ? [v, e[1]] : [e[0], v]) : e)));
  const move = (i, d) => { const n = [...ex]; const t = n[i + d]; if (!t) return; n[i + d] = n[i]; n[i] = t; setEx(n); };
  const save = async () => {
    if (!name.trim()) return app.toast('Poné un nombre a la rutina', 'error');
    setBusy(true);
    const r = { key: orig?.key, name: name.trim(), full: full.trim(), ex: ex.filter((e) => e[0].trim()).map((e) => [e[0].trim(), e[1].trim()]) };
    const next = index != null ? list.map((x, i) => (i === index ? r : x)) : [...list, r];
    try { await saveRoutines(app, next); app.toast('Rutina guardada ✓'); app.closeSheet(); } catch (e) { app.toast(e.message, 'error'); setBusy(false); }
  };
  const del = async () => {
    if (list.length <= 1) return app.toast('Tiene que quedar al menos una rutina', 'error');
    if (!confirm(`¿Eliminar la rutina ${orig.name}?`)) return;
    await saveRoutines(app, list.filter((_, i) => i !== index));
    app.toast('Rutina eliminada'); app.closeSheet();
  };
  return html`<div class="stack">
    <div class="grid2">
      <${Field} label="Nombre"><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Ej: Push" /><//>
      <${Field} label="Músculos"><input value=${full} onInput=${(e) => setFull(e.target.value)} placeholder="Ej: Pecho y tríceps" /><//>
    </div>
    <h3 class="section-title">Ejercicios</h3>
    <div class="edit-ex">${ex.map((e, i) => html`<div class="edit-row">
      <div class="edit-order"><button class="icon-btn sm" onClick=${() => move(i, -1)} aria-label="Subir">▲</button><button class="icon-btn sm" onClick=${() => move(i, 1)} aria-label="Bajar">▼</button></div>
      <div class="edit-fields">
        <input value=${e[0]} placeholder="Ejercicio" onInput=${(ev) => setRow(i, 0, ev.target.value)} />
        <input value=${e[1]} placeholder="Series (ej 4×10)" onInput=${(ev) => setRow(i, 1, ev.target.value)} />
      </div>
      <button class="icon-btn" onClick=${() => setEx(ex.filter((_, x) => x !== i))} aria-label="Quitar"><${Icon} name="trash" size=${16} /></button>
    </div>`)}</div>
    <button class="btn ghost small" onClick=${() => setEx([...ex, ['', '']])}><${Icon} name="plus" size=${16} /> Agregar ejercicio</button>
    <button class="btn primary" disabled=${busy} onClick=${save}>Guardar rutina</button>
    ${orig && html`<button class="btn danger ghost" onClick=${del}><${Icon} name="trash" size=${16} /> Eliminar rutina</button>`}
  </div>`;
}

// Entrenador IA: crea una rutina nueva o mejora la actual.
function RoutineAI() {
  const app = useApp();
  const current = routines(app.H);
  const [mode, setMode] = useState('new');
  const [f, setF] = useState({ goal: '', days: String(Math.min(6, Math.max(2, current.length || 4))), minutes: '60', level: 'intermedio', equipment: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!hasAI(app.profile)) return html`<${NoAiKey} />`;

  const run = async () => {
    if (mode === 'new' && !f.goal.trim()) return app.toast('Contale tu objetivo', 'error');
    setBusy(true); setOut(null);
    try { setOut(await generateRoutines(app.profile, { ...f, mode: mode === 'new' ? 'new' : 'improve', current })); }
    catch (e) { app.toast(e.message, 'error'); }
    setBusy(false);
  };
  const use = async () => {
    const list = out.routines.map((r) => ({ name: r.name, full: r.focus || '', ex: (r.exercises || []).map((e) => [e.name, e.sets || '']) }));
    await saveRoutines(app, list);
    if (out.tips) {
      const p = app.profile;
      if (engineOf(app.H) === 'weekly') await app.saveProfile({ ...p, plan: { ...p.plan, tips: out.tips } });
    }
    app.toast('¡Rutinas nuevas listas! 💪'); app.closeSheet();
  };

  if (out) return html`<div class="stack pop-in">
    <p class="small muted">Revisalas. Al usarlas reemplazan tus rutinas actuales (tu historial de pesos se mantiene).</p>
    ${out.routines.map((r) => html`<section class="card"><h3 class="d big">${r.name}</h3>${r.focus && html`<p class="small muted">${r.focus}</p>`}<${ExList} ex=${(r.exercises || []).map((e) => [e.name, e.sets])} /></section>`)}
    ${out.tips && html`<p class="small muted">💡 ${out.tips}</p>`}
    <div class="grid2"><button class="btn ghost" onClick=${() => setOut(null)}>Ajustar</button><button class="btn primary" onClick=${use}>Usar estas rutinas</button></div>
  </div>`;

  return html`<div class="stack">
    <${Segmented} value=${mode} onChange=${setMode} options=${[{ id: 'new', label: 'Rutina nueva' }, { id: 'improve', label: 'Mejorar la mía' }]} />
    ${mode === 'improve' && html`<p class="small muted">La IA toma tus ${current.length} rutinas actuales y las rediseña al nivel que elijas.</p>`}
    <${Field} label=${mode === 'new' ? 'Objetivo' : '¿Qué querés lograr con el cambio? (opcional)'}><input placeholder="Ej: ganar masa muscular / tonificar glúteos / más fuerza" value=${f.goal} onInput=${set('goal')} /><//>
    <div class="grid2">
      <${Field} label="Días de gym"><select value=${f.days} onChange=${set('days')}>${[2, 3, 4, 5, 6].map((n) => html`<option value=${n}>${n} por semana</option>`)}</select><//>
      <${Field} label="Tiempo"><select value=${f.minutes} onChange=${set('minutes')}>${[30, 45, 60, 75, 90].map((n) => html`<option value=${n}>${n} min</option>`)}</select><//>
    </div>
    <${Field} label="Nivel"><${Segmented} value=${f.level} onChange=${(v) => setF({ ...f, level: v })} options=${LEVELS} /><//>
    <${Field} label="Equipamiento"><input placeholder="Ej: gimnasio completo" value=${f.equipment} onInput=${set('equipment')} /><//>
    <${Field} label="Lesiones o preferencias (opcional)"><input placeholder="Ej: me molesta el hombro, me gusta el peso muerto" value=${f.notes} onInput=${set('notes')} /><//>
    <button class="btn primary big" disabled=${busy} onClick=${run}><${Icon} name="sparkles" size=${18} /> ${busy ? 'Armando…' : mode === 'new' ? 'Crear rutina' : 'Mejorar mi rutina'}</button>
    ${busy && html`<${Spinner} label="El entrenador está armando tu rutina…" />`}
  </div>`;
}

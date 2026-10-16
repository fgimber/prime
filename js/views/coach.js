import { html, useState, useEffect, useRef } from '../lib.js';
import { db } from '../store.js';
import { useApp, r0, sum, isoDate, addDays, diaryRow, guessMeal } from '../util.js';
import { ageFrom, GOALS, ACTIVITY, MEALS } from '../nutrition.js';
import { askCoach, fileToBase64, itemToFood, hasAI } from '../ai.js';
import { hasPlan, engineOf, dayLabel, isGymDay, foodItems, trainItems, getRoutine, suggest, libresWeek, rulesOf, isChecked, planName } from '../gym-data.js';
import { Icon, MacroPills } from '../components.js';
import { NoAiKey } from './ai-log.js';

// Cada usuario tiene su propia conversación en este dispositivo.
const storeKey = (uid) => `prime:coach:${uid || 'anon'}`;
const loadChat = (uid) => { try { return JSON.parse(localStorage.getItem(storeKey(uid))) || []; } catch { return []; } };
const saveChat = (uid, msgs) => { try { localStorage.setItem(storeKey(uid), JSON.stringify(msgs.slice(-40))); } catch {} };

const SUGGESTIONS = [
  '¿Puedo comer una pizza hoy?',
  '¿Qué ceno con lo que me queda?',
  'Tengo antojo de algo dulce',
  '¿Qué como antes de entrenar?',
  '¿Me conviene tomar creatina?',
  'Voy a comer afuera, ¿qué pido?',
];
// Sugerencia extra solo para quien trabaja con guardias.
const suggestionsFor = (H) => (engineOf(H) === 'guardia' ? [...SUGGESTIONS.slice(0, 3), 'Estoy de guardia y no tengo tupper', ...SUGGESTIONS.slice(3)] : SUGGESTIONS);

const VERDICT = {
  si: { label: 'Sí, encaja', cls: 'ok' },
  moderacion: { label: 'Con moderación', cls: 'part' },
  no: { label: 'Mejor no hoy', cls: 'no' },
};

// Arma el contexto que recibe la IA: perfil, objetivos, lo comido hoy, el plan y el entrenamiento del día.
async function buildContext(app) {
  const { profile: p, targets: t, meals, H } = app;
  const today = isoDate();
  const [entries, weights] = await Promise.all([
    db.list('diary', { eq: { date: today }, order: 'created_at', asc: true }).catch(() => []),
    db.list('weights', { gte: { date: addDays(today, -21) }, order: 'date', asc: true }).catch(() => []),
  ]);
  const eaten = sum(entries);
  const lines = [];
  const goal = GOALS.find((g) => g.id === p.goal);
  const act = ACTIVITY.find((a) => a.id === p.activity);
  lines.push(`Fecha y hora: ${new Date().toLocaleString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`);
  lines.push(`Perfil: ${p.sex === 'f' ? 'mujer' : 'hombre'}, ${ageFrom(p.birthdate) || '?'} años, ${p.height || '?'} cm, ${p.weight || '?'} kg${p.bodyfat ? `, ${p.bodyfat}% grasa` : ''}. Actividad: ${act?.label || '?'}. Objetivo: ${goal?.label || '?'}.`);
  if (p.primeWeight) lines.push(`Meta de peso: llegar a ${p.primeWeight} kg${p.primeBodyfat ? ` y ${p.primeBodyfat}% de grasa` : ''}${p.primeDate ? ` para el ${p.primeDate}` : ''}.${p.primeNotes ? ` Notas: ${p.primeNotes}` : ''}`);
  if (weights.length) lines.push(`Pesos recientes: ${weights.map((w) => `${w.date.slice(5)}: ${w.kg}`).join(', ')}.`);
  if (t) {
    lines.push(`Objetivo diario: ${t.kcal} kcal, ${t.protein} g proteína, ${t.carbs} g carbos, ${t.fat} g grasa, ${t.fiber} g fibra.`);
    lines.push(`Comido hoy: ${r0(eaten.kcal)} kcal, P ${r0(eaten.protein)} g, C ${r0(eaten.carbs)} g, G ${r0(eaten.fat)} g.`);
    lines.push(`LE QUEDA HOY: ${r0(t.kcal - eaten.kcal)} kcal, P ${r0(t.protein - eaten.protein)} g, C ${r0(t.carbs - eaten.carbs)} g, G ${r0(t.fat - eaten.fat)} g.`);
  }
  if (entries.length) {
    const byMeal = MEALS.map((m) => {
      const es = entries.filter((e) => e.meal === m.id);
      return es.length ? `${m.label}: ${es.map((e) => `${e.name} ${r0(e.grams)} g (${r0(e.kcal)} kcal)`).join('; ')}` : null;
    }).filter(Boolean);
    lines.push(`Registro de hoy → ${byMeal.join(' | ')}.`);
  } else lines.push('Todavía no registró comidas hoy.');
  lines.push(`Comidas del día y reparto: ${meals.filter((m) => m.share).map((m) => `${m.label} ${m.share}%`).join(', ')}.`);
  if (p.planExclude) lines.push(`No come / excluye: ${p.planExclude}.`);
  if (p.planNotes) lines.push(`Preferencias: ${p.planNotes}.`);

  if (hasPlan(H)) {
    const d = H.days[today] || { c: {} };
    const guardia = engineOf(H) === 'guardia';
    if (guardia) lines.push('Trabaja en guardias de 24x48 (guardia, franco 1, franco 2).');
    lines.push(`Plan "${planName(H)}". Hoy: ${dayLabel(today, H)} (mañana: ${dayLabel(addDays(today, 1), H)}).`);
    if (isGymDay(today, H)) {
      const r = getRoutine(H, d.rut || suggest(today, H).r);
      lines.push(`Entrenamiento de hoy: gym ${r?.name || ''}${r?.full ? ` (${r.full})` : ''}${d.gym ? `, ya hecho (${d.gym === 'full' ? 'completo' : 'versión mínima'})` : ', todavía no lo hizo'}${d.run ? ', más running' : ''}.`);
    }
    const tr = trainItems(today, H);
    if (tr.length) lines.push(`Tareas de hoy: ${tr.map((i) => `${i.t}${isChecked(d, i.k) ? ' (hecho)' : ''}`).join(', ')}.`);
    lines.push(`Plan de comida de hoy: ${foodItems(today, H).filter((i) => ['des', 'alm', 'mer', 'cen'].includes(i.k)).map((i) => `${i.t}${i.s ? ': ' + i.s : ''}${isChecked(d, i.k) ? ' (cumplido)' : ''}`).join(' | ')}.`);
    if (guardia) lines.push(`Comidas libres usadas esta semana: ${libresWeek(today, H)} de 1 permitida.${d.planb ? ' Hoy activó el Plan B (no pudo cocinar).' : ''}`);
    lines.push(`Agua hoy: ${((d.water_ml || 0) / 1000).toFixed(2)} L.`);
    const rules = rulesOf(H);
    if (rules.length) lines.push(`Sus reglas: ${rules.join(' ')}`);
  }
  if (engineOf(H) === 'guardia') lines.push('Sistema: cocina "la tanda" (pollo, carne picada, arroz, huevos duros) cada franco 2 y come tuppers en la guardia.');
  return lines.join('\n');
}

// Markdown mínimo y seguro: **negrita** y viñetas "- ".
function Rich({ text }) {
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((part) => (part.startsWith('**') && part.endsWith('**') ? html`<b>${part.slice(2, -2)}</b>` : part));
  const blocks = [];
  let list = null;
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*[-•*]\s+(.*)/);
    if (m) { (list = list || []).push(m[1]); continue; }
    if (list) { blocks.push(html`<ul>${list.map((li) => html`<li>${inline(li)}</li>`)}</ul>`); list = null; }
    if (line.trim()) blocks.push(html`<p>${inline(line)}</p>`);
  }
  if (list) blocks.push(html`<ul>${list.map((li) => html`<li>${inline(li)}</li>`)}</ul>`);
  return html`<div class="rich">${blocks}</div>`;
}

export function CoachChat({ initial }) {
  const app = useApp();
  const uid = app.user?.id;
  const [msgs, setMsgs] = useState(() => loadChat(uid));
  const ctxRef = useRef(null);
  const [text, setText] = useState(initial || '');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const endRef = useRef();

  useEffect(() => { saveChat(uid, msgs.filter((m) => !m.streaming)); endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);
  // El contexto se arma apenas se abre el chat, así la respuesta arranca sin esperar a la base de datos.
  const refreshCtx = () => { ctxRef.current = buildContext(app).catch(() => ''); };
  useEffect(() => { refreshCtx(); }, [app.version]);

  if (!hasAI(app.profile)) return html`<${NoAiKey} />`;

  const send = async (q) => {
    const question = (q ?? text).trim();
    if (!question && !photo) return;
    const userMsg = { role: 'user', text: question, photo: photo?.preview || null };
    const history = msgs;
    setMsgs([...history, userMsg]);
    setText(''); setBusy(true);
    const sentPhoto = photo; setPhoto(null);
    try {
      const ctx = await (ctxRef.current || buildContext(app));
      let started = false;
      const reply = await askCoach(app.profile, ctx, history, { text: question, photo: sentPhoto }, (partial) => {
        if (!partial.text) return;
        const first = !started;
        started = true;
        const msg = { role: 'model', streaming: true, ...partial };
        setMsgs((m) => (first ? [...m, msg] : [...m.slice(0, -1), msg]));
      });
      setMsgs((m) => [...(started ? m.slice(0, -1) : m), { role: 'model', ...reply }]);
    } catch (e) {
      setMsgs((m) => [...m.filter((x) => !x.streaming), { role: 'model', verdict: 'info', text: '⚠️ ' + e.message, error: true }]);
    }
    setBusy(false);
    refreshCtx();
    app.refreshAi?.();
  };

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { setPhoto(await fileToBase64(f, 900)); } catch (err) { app.toast(err.message, 'error'); }
  };

  const logItems = async (items, idx) => {
    const meal = guessMeal();
    try {
      await db.insertMany('diary', items.map((it) => diaryRow(itemToFood(it), it.grams, meal, isoDate())));
      setMsgs((m) => m.map((x, i) => (i === idx ? { ...x, logged: true } : x)));
      app.bump();
      app.toast(`Registrado en ${MEALS.find((x) => x.id === meal).label} ✓`);
    } catch (e) { app.toast(e.message, 'error'); }
  };

  const reset = () => { if (confirm('¿Empezar una conversación nueva? La actual se borra.')) { setMsgs([]); setText(''); setPhoto(null); } };
  const grow = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; };

  return html`
    <div class="coach">
      ${msgs.length > 0 && html`<div class="coach-top">
        <span class="small muted">${msgs.filter((m) => m.role === 'user').length} ${msgs.filter((m) => m.role === 'user').length === 1 ? 'pregunta' : 'preguntas'}</span>
        <button class="pill-btn new-chat" onClick=${reset} disabled=${busy}><${Icon} name="plus" size=${14} /> Nuevo chat</button>
      </div>`}
      <div class="coach-msgs">
        ${!msgs.length && html`
          <div class="coach-hero">
            <div class="coach-avatar big"><${Icon} name="sparkles" size=${26} /></div>
            <h3>¿En qué te ayudo hoy?</h3>
            <p class="muted small">Sé lo que comiste, lo que te queda, tu entrenamiento y tu plan. Preguntame lo que quieras o mandame una foto de un plato, un producto o una carta.</p>
          </div>
          <div class="sugg-row">${suggestionsFor(app.H).map((s) => html`<button class="chip" onClick=${() => send(s)}>${s}</button>`)}</div>`}
        ${msgs.map((m, i) => m.role === 'user'
          ? html`<div class="msg user"><div class="bubble user">${m.photo && html`<img src=${m.photo} alt="Foto enviada" />`}${m.text && html`<p>${m.text}</p>`}</div></div>`
          : html`<div class=${'msg bot' + (m.error ? ' err' : '')}>
              <span class="coach-avatar sm"><${Icon} name="sparkles" size=${14} /></span>
              <div class="bot-body">
                ${VERDICT[m.verdict] && html`<span class=${'verdict ' + VERDICT[m.verdict].cls}>${VERDICT[m.verdict].label}</span>`}
                <${Rich} text=${m.text} />
                ${m.items?.length > 0 && html`<div class="coach-items">
                  ${m.items.map((it) => html`<div class="ci"><span>${it.name} · ${it.grams} g</span><span class="muted">${r0(it.kcal)} kcal</span></div>`)}
                  <div class="ci-foot"><${MacroPills} m=${sum(m.items)} compact />
                    <button class="btn small primary" disabled=${m.logged} onClick=${() => logItems(m.items, i)}>${m.logged ? 'Registrado ✓' : 'Registrar'}</button></div>
                </div>`}
              </div>
            </div>`)}
        ${busy && !msgs.at(-1)?.streaming && html`<div class="msg bot"><span class="coach-avatar sm"><${Icon} name="sparkles" size=${14} /></span><div class="typing"><span></span><span></span><span></span></div></div>`}
        <div ref=${endRef}></div>
      </div>

      <div class="composer">
        ${photo && html`<div class="photo-chip"><img src=${photo.preview} alt="" /><button class="icon-btn" onClick=${() => setPhoto(null)} aria-label="Quitar foto"><${Icon} name="x" size=${14} /></button></div>`}
        <div class="composer-bar">
          <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${pick} />
          <button class="icon-btn" onClick=${() => fileRef.current.click()} aria-label="Adjuntar foto"><${Icon} name="camera" /></button>
          <textarea rows="1" placeholder="Escribile a tu nutricionista…" value=${text}
            onInput=${(e) => { setText(e.target.value); grow(e.target); }}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); e.target.style.height = 'auto'; } }}></textarea>
          <button class="send-btn" disabled=${busy || (!text.trim() && !photo)} onClick=${() => send()} aria-label="Enviar"><${Icon} name="send" size=${18} /></button>
        </div>
      </div>
    </div>`;
}

// Acceso rápido para poner en Hoy / Comida.
export function CoachCard() {
  const app = useApp();
  const open = (q) => app.openSheet(html`<${CoachChat} initial=${q || ''} />`, 'Nutricionista IA');
  return html`<button class="coach-card" onClick=${() => open()}>
    <span class="coach-avatar"><${Icon} name="sparkles" size=${20} /></span>
    <span class="txt"><b>¿Puedo comer esto?</b><small>Preguntale a tu nutricionista IA</small></span>
    <${Icon} name="right" />
  </button>`;
}

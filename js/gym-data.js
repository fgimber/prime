// Plan de entrenamiento + sistema de comida, por usuario.
// Dos motores:
//  - 'guardia': el sistema original "Volver al prime" (rotación 24x48, tandas, plan B, running).
//  - 'weekly' : plan semanal armado por la IA a partir de la rutina del usuario.
// H = { settings: { firstGuardia, planStart }, plan: {...} | null, days: { 'YYYY-MM-DD': { c:{}, gym, rut, run, planb, libre, water_ml } } }
import { addDays, parseISO, isoDate, daysBetween } from './util.js';

export const PLAN_START = '2026-10-01';
export const startOf = (H) => H.settings?.planStart || PLAN_START;

export const ROUT = {
  PU: { name: 'Push', full: 'Pecho, hombro y tríceps', ex: [['Press plano con barra', '1×15, 2×12, 2×10'], ['Press inclinado mancuernas', '2×12, 2×10'], ['Cruces en polea', '3×15'], ['Press militar manc + vuelos laterales (superserie)', '4 × 12 + 20'], ['Francés con barra W', '3×15'], ['Tríceps polea soga', '3×15'], ['Cardio: cinta inclinada', '15–20 min']] },
  PL: { name: 'Pull', full: 'Espalda y bíceps', ex: [['Dominadas prolijas', '3 × al fallo'], ['Remo con barra', '2×12, 2×10'], ['Tirones polea al frente', '3×12'], ['Serrucho pesado', '3×10'], ['Remo bajo en polea', '3×10'], ['Pull over en polea', '3×12'], ['Bíceps barra de pie', '3×10'], ['Barra W en banco Scott', '3×12'], ['Abdominales', '150 reps'], ['Cardio: cinta inclinada', '15–20 min']] },
  PI: { name: 'Pierna', full: 'Cuádriceps, isquios y gemelos', ex: [['Sentadilla con barra', '4 × 15-12-10-8 (subiendo peso)'], ['Peso muerto', '2×12, 1×10, 1×8'], ['Prensa', '1×20, 2×15'], ['Búlgaras', '3×12 por pierna'], ['Camilla isquios', '3×12 + 12 bajada en la última'], ['Sillón de cuádriceps', '3×10 + 10 bajada en la última'], ['Gemelos', '4×20'], ['Abdominales', '150 reps']] },
  BR: { name: 'Brazo', full: 'Hombro y brazos', ex: [['Press militar mancuernas', '2×12, 2×10'], ['Vuelos laterales', '4×12 + 12 bajada en la última'], ['Posteriores en máquina o manc', '3×20'], ['Trapecio con mancuernas', '3×15'], ['Bíceps manc alternado', '4 × 15-12-10-8 (subiendo peso)'], ['Banco Scott con mancuerna', '3×12'], ['Tríceps polea', '4 × 15-12-10-8 (subiendo peso)'], ['Mancuerna tras nuca', '3×12'], ['Cardio: cinta inclinada', '15–20 min']] },
};
export const RK = ['PU', 'PL', 'PI', 'BR'];
const LEG = { A: 'PU', B: 'PI', C: 'BR' };
export const nr = (r) => LEG[r] || r;

// ---------- motor ----------
export const engineOf = (H) => H.plan?.engine || (H.settings?.firstGuardia ? 'guardia' : null);
export const hasPlan = (H) => !!engineOf(H);
const isWeekly = (H) => engineOf(H) === 'weekly';
const wd = (k) => parseISO(k).getDay();
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);

export function routines(H) {
  if (isWeekly(H)) return H.plan.routines || [];
  return RK.map((k) => ({ key: k, ...ROUT[k] }));
}
export const routineKeys = (H) => routines(H).map((r) => r.key);
export const getRoutine = (H, key) => routines(H).find((r) => r.key === (isWeekly(H) ? key : nr(key))) || routines(H)[0];
export const planName = (H) => (isWeekly(H) ? H.plan.name : 'Volver al prime');
export const weekDay = (k, H) => (isWeekly(H) ? H.plan.week?.[wd(k)] || { label: 'Día libre', kind: 'rest', train: [] } : null);
export function isGymDay(k, H) {
  if (isWeekly(H)) return weekDay(k, H).kind === 'gym';
  return dayType(k, H) !== 'G';
}
export function dayLabel(k, H) {
  if (isWeekly(H)) return weekDay(k, H).label;
  return typeName[dayType(k, H)];
}

export const HOME_CIRCUIT = [['Flexiones', '15'], ['Sentadillas', '20'], ['Estocadas', '12 por pierna'], ['Fondos en silla', '12'], ['Plancha', '45 s'], ['Mountain climbers', '20']];
export const GYM_TIPS = 'Cuando completás todas las series en el tope de repeticiones, la próxima subís 2,5 kg (1–2 kg en mancuernas). Dejá 1–2 reps en reserva en los compuestos. Cardio: cinta al 10–12% de inclinación, 5–5,5 km/h; nunca después de pierna. Descanso: 2–3 min en compuestos, 60–90 s en el resto. En la última serie de cada ejercicio, llegá cerca del fallo.';

export const OPT = {
  des: ['3 huevos revueltos + tostada integral + fruta', 'Yogur + 1 scoop de whey + avena + banana', '2 tostadas con queso untable light + 2 huevos duros + café'],
  mer: ['Licuado: whey + banana + leche descremada', 'Yogur descremado + whey + fruta', 'Tostada integral con atún o 2 huevos + fruta'],
  rec: [['Pollo al horno con papas', 'Bandeja al horno: meter y olvidar 45 min'], ['Guiso de lentejas con carne picada', 'Rinde para 3 comidas. Freezá lo que sobre'], ['Tortilla de papa con 4 huevos + ensalada', 'Barata y lleva 15 min'], ['Arroz con pollo y verduras', 'Todo en una olla'], ['Hamburguesas caseras al plato', 'Carne picada + huevo. Con ensalada, sin pan'], ['Fideos con boloñesa', '1 plato chico de fideos, mucha salsa con carne'], ['Milanesas de pollo al horno + puré', 'Al horno, nunca fritas']],
};
export const TANDA = [['1 kg de pollo (pata-muslo o pechuga)', 'Bandeja al horno con papas y cebolla, 45 min'], ['500 g de carne picada', 'Boloñesa en una olla mientras está el horno'], ['Arroz', 'Una olla grande'], ['8 huevos duros', '10 min, mientras se hace el resto'], ['Freezer', 'Lo que no comés en 3 días va al freezer en tuppers']];
export const COMPRAS = [
  ['Del mes: proteínas (se freezan en porciones)', ['Pollo 6 kg (pata-muslo es más barato)', 'Carne picada común 3 kg', 'Huevos 4 maples', 'Atún al natural 12 latas', 'Lentejas 2 kg']],
  ['Del mes: almacén', ['Arroz 4 kg', 'Fideos 2 kg', 'Avena 2 kg', 'Galletas de arroz x6', 'Salsa de tomate x6', 'Especias, aceite en spray, gelatina light']],
  ['Del mes: opcional si alcanza', ['Whey 1 kg (la proteína más barata por gramo)']],
  ['Reposición semanal (se pudre si comprás por mes)', ['Leche y yogur', 'Fruta: bananas, manzanas', 'Verdura: papa, cebolla, tomate, lechuga, zanahoria', 'Pan integral (se puede freezar)']],
];
export const SISTEMA = [['1 vez por mes', 'Compra grande + freezar porciones'], ['1 vez por semana', 'Fruta, verdura, leche, pan'], ['Franco 1', 'Pasás la proteína del freezer a la heladera'], ['Franco 2', 'Cocinás la tanda (1 h)'], ['Guardia', 'Comés los tuppers']];
export const EN_CASA = [['Cocinó carne, pollo, milanesa o guiso', 'Comé eso'], ['Cómo armar el plato', 'Mitad proteína, mitad verdura, poco hidrato'], ['Pidió pizza o empanadas', 'Plato de 5 minutos'], ['Si igual comés pizza', 'Máximo 2 porciones + atún o huevos']];
export const PLATOS_5 = ['4 huevos revueltos + 2 tostadas + tomate', 'Atún + 2 huevos duros + arroz de la heladera', 'Tupper del freezer al microondas', 'Tortilla express: 4 huevos + papa hervida del día anterior', 'Yogur + whey + avena + banana'];
export const PLAN_B = [['1. Freezer', 'Sacás 2 tuppers a la mañana'], ['2. Kit de guardia', 'Atún + 2 huevos duros + pan + fruta'], ['3. Comprar', 'Spiedo + ensalada o sándwich de pollo']];
export const REGLAS = ['Un día de gym no se saltea, se achica.', 'La tanda no se negocia: si no podés el franco 2, va el franco 1.', 'Nunca dos fallas seguidas.', 'Proteína primero en cada comida.', 'Sin dulces en casa.', 'Solo manda el promedio semanal del peso.', 'Si no está marcado, no pasó.'];

// Claves de las comidas del plan ↔ comidas del diario
export const MEAL_KEY = { des: 'desayuno', alm: 'almuerzo', mer: 'merienda', cen: 'cena' };
export const KEY_OF_MEAL = { desayuno: 'des', almuerzo: 'alm', merienda: 'mer', cena: 'cen' };

const diff = (a, b) => daysBetween(b, a); // días de b a a
export const typeName = { G: 'Guardia', F1: 'Franco 1', F2: 'Franco 2' };

export function dayType(k, H) {
  if (isWeekly(H)) return 'W' + wd(k);
  const g = H.settings?.firstGuardia;
  if (!g) return 'F1';
  const m = ((diff(k, g) % 3) + 3) % 3;
  return m === 0 ? 'G' : m === 1 ? 'F1' : 'F2';
}

export function runPlan(k, H) {
  const w = Math.max(1, Math.floor(diff(k, startOf(H)) / 7) + 1);
  const m = w <= 2 ? 20 : w <= 4 ? 25 : w <= 6 ? 30 : 35;
  return { w, m, steps: [['Entrada en calor', '5 min caminando rápido'], ['Trote suave', m + ' min a ritmo de charla'], ['Si te ahogás', 'Alterná 4 min trote / 1 min caminando'], ['Vuelta a la calma', '5 min caminando + elongar']] };
}

const rot = (arr, k, H, o = 0) => arr[(((diff(k, startOf(H)) + o) % arr.length) + arr.length) % arr.length];

export function foodItems(k, H) {
  if (isWeekly(H)) {
    const n = Math.max(0, diff(k, startOf(H)));
    const meals = (H.plan.meals || []).map((m) => {
      const opts = m.options?.length ? m.options : [{ t: m.t, s: '' }];
      const o = opts[n % opts.length];
      return { k: m.k, t: `${m.t} · ${o.t}`, s: o.s || '' };
    });
    return meals.concat(H.plan.habits || []);
  }
  const t = dayType(k, H);
  const r = rot(OPT.rec, k, H), r2 = rot(OPT.rec, k, H, 3);
  const pb = t === 'G' && H.days[addDays(k, -1)]?.planb;
  const m = {
    G: [['des', 'Desayuno', 'Antes de salir: ' + rot(OPT.des, k, H)], ['alm', 'Almuerzo', pb ? 'Plan B: tupper del freezer, o atún + 2 huevos duros + pan integral + fruta' : 'Tupper 1 de la tanda'], ['mer', 'Merienda', 'Yogur, huevos duros o galletas de arroz con atún'], ['cen', 'Cena', pb ? 'Plan B: kit de guardia o pollo al spiedo con ensalada' : 'Tupper 2 de la tanda']],
    F1: [['des', 'Desayuno', rot(OPT.des, k, H)], ['alm', 'Almuerzo', 'Lo último que quedó de la tanda'], ['mer', 'Merienda', rot(OPT.mer, k, H)], ['cen', 'Cena · ' + r[0], r[1] + '. Si en casa cocinaron otra cosa, mirá "Comiendo en casa"']],
    F2: [['des', 'Desayuno', rot(OPT.des, k, H)], ['alm', 'Almuerzo · ' + r2[0], r2[1]], ['mer', 'Merienda', rot(OPT.mer, k, H)], ['cen', 'Cena', 'Una porción de la tanda que cocinaste hoy']],
  }[t];
  return m.map((x) => ({ k: x[0], t: x[1], s: x[2] })).concat([
    { k: 'limpia', t: 'Sin dulces ni harinas', s: 'Antojo: yogur con whey, gelatina light o fruta' },
    { k: 'agua', t: '3 litros de agua', s: 'Coca Zero: máximo 1' },
  ]);
}

export function trainItems(k, H) {
  if (isWeekly(H)) return weekDay(k, H).train || [];
  const type = dayType(k, H);
  if (type === 'G') return [
    { k: 'bici', t: 'Bici ida y vuelta', s: 'El cardio del día' },
    { k: 'casa', t: '5×20 flexiones + 3×1 min plancha', s: 'En la dependencia' },
    { k: 'plan', t: 'Planificar el próximo ciclo', s: 'Rutinas y comidas de los dos francos' },
  ];
  const a = [{ k: 'pasos', t: '8.000–10.000 pasos', s: '' }];
  if (type === 'F1') {
    a.push({ k: 'caminata', t: 'Caminata de 30–40 min', s: 'Compensa la guardia' });
    a.push({ k: 'compras', t: 'Sacar del freezer la proteína de mañana', s: '1 kg de pollo y 500 g de carne a la heladera. ¿Mañana no estás? Cociná hoy' });
  }
  if (type === 'F2') a.push({ k: 'tuppers', t: 'Cocinar la tanda (1 h)', s: 'Cena de hoy + 2 tuppers de guardia + almuerzo del franco' });
  return a;
}

export const isChecked = (d, key) => (key === 'agua' ? !!(d?.c?.agua || (d?.water_ml || 0) >= 3000) : !!d?.c?.[key]);

export function coreDone(k, H) {
  const d = H.days[k];
  if (isWeekly(H)) {
    if (isGymDay(k, H)) return !!d?.gym;
    const tr = trainItems(k, H);
    return tr.length ? tr.some((i) => isChecked(d, i.k)) : !!d;
  }
  if (!d) return false;
  if (dayType(k, H) === 'G') return !!(d.c?.bici || d.c?.casa);
  return !!d.gym;
}

function allItems(k, H) {
  const a = trainItems(k, H).map((i) => i.k).concat(foodItems(k, H).map((i) => i.k));
  if (isGymDay(k, H)) a.push('gym');
  return a;
}

export function status(k, H) {
  const tk = isoDate();
  if (k > tk) return 'future';
  const d = H.days[k];
  const done = allItems(k, H).every((i) => (i === 'gym' ? d?.gym === 'full' : isChecked(d, i)));
  if (done) return 'ok';
  if (coreDone(k, H)) return 'part';
  return k === tk ? 'open' : 'miss';
}

export function streaks(H) {
  const tk = isoDate();
  let cur = 0;
  let k = coreDone(tk, H) ? tk : addDays(tk, -1);
  const first = Object.keys(H.days).sort()[0];
  while (first && k >= first && coreDone(k, H)) { cur++; k = addDays(k, -1); }
  let best = 0, run = 0;
  if (first) {
    for (let x = first; x <= tk; x = addDays(x, 1)) {
      if (coreDone(x, H)) { run++; best = Math.max(best, run); } else if (x !== tk) run = 0;
    }
  }
  return { cur, best: Math.max(best, cur) };
}

export function lastDone(H) {
  const last = Object.fromEntries(routineKeys(H).map((k) => [k, '']));
  const norm = isWeekly(H) ? (r) => r : nr;
  Object.keys(H.days).sort().forEach((k) => { const d = H.days[k]; if (d.gym && d.rut) last[norm(d.rut)] = k; });
  return last;
}

export function suggest(k, H) {
  if (isWeekly(H)) {
    const w = weekDay(k, H);
    if (w.routine && routineKeys(H).includes(w.routine)) return { r: w.routine, note: '' };
    const last = {};
    Object.keys(H.days).filter((x) => x < k).sort().forEach((x) => { const d = H.days[x]; if (d.gym && d.rut) last[d.rut] = x; });
    const order = routineKeys(H).sort((a, b) => (last[a] || '0').localeCompare(last[b] || '0'));
    return { r: order[0], note: '' };
  }
  const last = { PU: '', PL: '', PI: '', BR: '' };
  Object.keys(H.days).filter((x) => x < k).sort().forEach((x) => { const d = H.days[x]; if (d.gym && d.rut) last[nr(d.rut)] = x; });
  let order = RK.slice().sort((a, b) => (last[a] || '0').localeCompare(last[b] || '0'));
  const wd = parseISO(k).getDay();
  let note = '';
  if ((wd === 5 || wd === 6) && order[0] === 'PI') {
    order = order.filter((r) => r !== 'PI').concat('PI');
    note = wd === 5 ? 'Mañana hay torneo: pierna queda para el próximo franco.' : 'Hoy hay torneo: pierna queda para el próximo franco.';
  }
  return { r: order[0], note };
}

export function libresWeek(k, H) {
  const d = parseISO(k);
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const x = new Date(mon);
    x.setDate(mon.getDate() + i);
    if (H.days[isoDate(x)]?.libre) n++;
  }
  return n;
}

// Resumen semanal desde el inicio del plan. weights: { date: kg }
export function weeks(H, weights) {
  const out = [];
  let w = startOf(H);
  const tk = isoDate();
  for (let i = 0; i < 60; i++) {
    const ks = [...Array(7)].map((_, j) => addDays(w, j));
    if (ks[0] > tk) break;
    const ps = ks.map((k) => weights[k]).filter((v) => typeof v === 'number');
    out.push({
      n: i + 1, from: w,
      avg: ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null,
      tr: ks.filter((k) => k <= tk && coreDone(k, H)).length,
      okd: ks.filter((k) => status(k, H) === 'ok').length,
    });
    w = addDays(w, 7);
  }
  return out;
}

// Convierte el respaldo de la app vieja ({settings, days}) en filas de Prime.
export function legacyToRows(json) {
  const days = [], weights = [];
  for (const [date, d] of Object.entries(json.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !d) continue;
    const { peso, ...rest } = d;
    const data = { c: rest.c || {} };
    for (const k of ['gym', 'rut', 'run', 'planb', 'libre']) if (rest[k] != null && rest[k] !== false) data[k] = rest[k];
    if (Object.values(data.c).some(Boolean) || Object.keys(data).length > 1) days.push({ date, data });
    if (typeof peso === 'number') weights.push({ date, kg: peso });
  }
  return { days, weights, settings: json.settings || {} };
}

export const isLegacyBackup = (json) => json && typeof json.days === 'object' && !Array.isArray(json.days) && !json.version;

// ---------- contenido de "Mi sistema" y Rutinas, según el plan ----------
export function systemSections(H) {
  if (isWeekly(H)) return H.plan.sections || [];
  return [
    { title: 'El sistema', text: 'No pensás qué comer: lo decide la rotación.', rows: SISTEMA },
    { title: 'La tanda', text: 'Lo que cocinás cada franco 2. Alcanza para la cena de ese día, 2 tuppers de guardia y el almuerzo del franco 1.', rows: TANDA },
    { title: 'Comiendo en casa', text: 'No tenés que cambiar lo que se cocina en casa. Usá esto:', rows: EN_CASA },
    { title: 'Platos de 5 minutos', text: 'Para cuando no hay nada hecho. Todos con 35–45 g de proteína.', rows: PLATOS_5 },
    { title: 'Plan B: no cociné', text: 'Si no vas a estar el franco 2, cociná la tanda el franco 1 a la noche. Si igual no pudiste, en Gym tocá "Hoy no puedo cocinar":', rows: PLAN_B },
    { title: 'Cenas para los dos', text: 'Rotan solas. Hacé doble y te sobra para el día siguiente.', rows: OPT.rec },
  ];
}
export const shoppingOf = (H) => (isWeekly(H) ? H.plan.shopping || [] : COMPRAS);
export const rulesOf = (H) => (isWeekly(H) ? H.plan.rules || [] : REGLAS);
export const tipsOf = (H) => (isWeekly(H) ? H.plan.tips || '' : GYM_TIPS);
export function routineExtras(H, k) {
  if (isWeekly(H)) return H.plan.extras || [];
  const rp = runPlan(k, H);
  return [
    { title: 'Gym cerrado', text: 'Domingos y feriados: 4 vueltas, 90 s de descanso entre vueltas. Marcá Versión mínima y la racha sigue.', rows: HOME_CIRCUIT },
    { title: 'Running opcional', text: `Reemplaza los pasos del día. Esta es la semana ${rp.w}: ${rp.m} min de trote.`, rows: [...rp.steps, ['Progresión', 'Sem 1–2: 20 · 3–4: 25 · 5–6: 30 · 7+: 35 min'], ['Frecuencia', 'Hasta 2 por semana']] },
  ];
}

// Convierte la respuesta de la IA en un plan semanal normalizado.
export function aiPlanToPlan(out) {
  const routinesList = (out.routines || []).map((r, i) => ({
    key: slug(r.key || r.name) || 'r' + i,
    name: r.name || `Rutina ${i + 1}`,
    full: r.focus || '',
    ex: (r.exercises || []).map((e) => [e.name, e.sets || '']),
  }));
  const keys = routinesList.map((r) => r.key);
  const findKey = (v) => {
    if (!v) return null;
    const s1 = slug(v);
    return keys.find((k) => k === s1) || routinesList.find((r) => slug(r.name) === s1)?.key || null;
  };
  const task = (prefix) => (t, i) => ({ k: `${prefix}_${slug(t.title) || i}`, t: t.title, s: t.detail || '' });
  const week = Array.from({ length: 7 }, (_, d) => {
    const w = (out.week || []).find((x) => +x.day === d) || { label: 'Descanso', kind: 'rest' };
    return {
      label: w.label || 'Día', kind: ['gym', 'cardio', 'rest', 'active'].includes(w.kind) ? w.kind : 'rest',
      routine: w.kind === 'gym' ? findKey(w.routine) || keys[0] || null : null,
      train: (w.tasks || []).map(task('t')),
    };
  });
  const MEAL_T = { des: 'Desayuno', alm: 'Almuerzo', mer: 'Merienda', cen: 'Cena' };
  const meals = ['des', 'alm', 'mer', 'cen'].map((k) => {
    const m = (out.meals || []).find((x) => x.key === k);
    return { k, t: MEAL_T[k], options: (m?.options || []).map((o) => ({ t: o.title, s: o.detail || '' })) };
  }).filter((m) => m.options.length);
  const habits = (out.habits || []).map(task('h'));
  if (!habits.some((h) => /agua/i.test(h.t))) habits.push({ k: 'agua', t: 'Tomar agua', s: '2,5–3 litros en el día' });
  else habits.forEach((h) => { if (/agua/i.test(h.t)) h.k = 'agua'; });
  return {
    engine: 'weekly',
    name: out.name || 'Mi plan',
    routines: routinesList,
    week, meals, habits,
    sections: (out.sections || []).map((x) => ({ title: x.title, text: x.text || '', rows: (x.rows || []).map((r) => (r.b ? [r.a, r.b] : r.a)) })),
    shopping: (out.shopping || []).map((c) => [c.category, c.items || []]),
    rules: out.rules || [],
    tips: out.tips || '',
    extras: [],
    created_at: new Date().toISOString(),
  };
}

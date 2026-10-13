// IA con Google Gemini (API gratuita de Google AI Studio). La key se guarda en tu perfil.
import { r0, r1 } from './util.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { getAccessToken } from './store.js';

// IA compartida: si la persona no tiene key propia y es miembro invitado, usa la del dueño vía servidor.
let sharedAI = false;
export const setSharedAI = (v) => { sharedAI = !!v; };

export const DEFAULT_MODEL = 'gemini-3.8-flash';

const ITEM = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    grams: { type: 'NUMBER' },
    kcal: { type: 'NUMBER' },
    protein: { type: 'NUMBER' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
    fiber: { type: 'NUMBER' },
  },
  required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
};

const ITEMS_SCHEMA = {
  type: 'OBJECT',
  properties: { items: { type: 'ARRAY', items: ITEM }, notes: { type: 'STRING' } },
  required: ['items'],
};

const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    meals: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { meal: { type: 'STRING' }, title: { type: 'STRING' }, items: { type: 'ARRAY', items: ITEM } },
        required: ['meal', 'items'],
      },
    },
  },
  required: ['meals'],
};

const SYSTEM = `Sos un nutricionista deportivo argentino. Estimás porciones y macronutrientes con precisión, usando valores de tablas de composición (USDA / ARGENFOODS) y porciones típicas de Argentina. Respondés siempre en español rioplatense. Los valores de cada ítem son TOTALES para los gramos indicados (no por 100 g). Si algo es ambiguo, asumí la porción más común y mencionalo en "notes".`;

export function hasAI(profile) {
  return Boolean((profile?.geminiKey || '').trim()) || sharedAI;
}

const MODEL_KEY = 'prime:aiModelOk';
const THINK_KEY = 'prime:aiThinkOk';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
// Menos razonamiento interno = respuestas mucho más rápidas. Si el modelo no acepta un nivel, se prueba el siguiente.
const THINK_LEVELS = ['minimal', 'low', ''];

function withThinking(body, level) {
  if (!level) return body;
  return { ...body, generationConfig: { ...(body.generationConfig || {}), thinkingConfig: { thinkingLevel: level } } };
}

// Modelos gratis de respaldo, por si el principal está saturado o sin cuota.
const BACKUP_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Hace el pedido con reintentos:
//  - saturado (503) → reintenta una vez y si sigue, usa un modelo de respaldo
//  - sin cuota (429) → modelo de respaldo (cada modelo tiene su propio límite gratis)
//  - modelo retirado → el que sugiere Google
//  - nivel de razonamiento no soportado → el siguiente
async function request(profile, body, stream) {
  const key = (profile?.geminiKey || '').trim();
  if (!key && !sharedAI) throw new Error('Para usar la IA ingresá el código de invitación o tu propia key (Perfil → IA).');
  const send = async (m, payload) => {
    if (key) {
      return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload),
      });
    }
    const token = await getAccessToken();
    return fetch(`${SUPABASE_URL}/functions/v1/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token || SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ model: m, stream, payload }),
    });
  };
  const primary = (profile.aiModel || '').trim() || ls.get(MODEL_KEY) || DEFAULT_MODEL;
  let model = primary;
  const thinkFor = (m) => { const v = ls.get(THINK_KEY + ':' + m); return v != null ? Math.max(0, THINK_LEVELS.indexOf(v)) : 0; };
  let ti = thinkFor(model);
  const tried = new Set([model]);
  let retriedBusy = false, modelSwitched = false, lastKind = null, lastMsg = '';
  const nextBackup = () => BACKUP_MODELS.find((m) => !tried.has(m));
  for (let attempt = 0; attempt < 10; attempt++) {
    let res;
    try {
      res = await send(model, withThinking(body, THINK_LEVELS[ti]));
    } catch {
      throw new Error('Sin conexión con Gemini. Revisá tu internet.');
    }
    if (res.ok) {
      if (model === primary || modelSwitched) ls.set(MODEL_KEY, model); // un respaldo temporal no reemplaza al principal
      ls.set(THINK_KEY + ':' + model, THINK_LEVELS[ti]);
      return res;
    }
    let j = await res.json().catch(() => ({}));
    if (Array.isArray(j)) j = j[0] || {};
    const msg = j.error?.message || `Error ${res.status}`;
    lastMsg = msg;
    if (/USER_LIMIT|NOT_MEMBER|CONFIG:/.test(msg)) throw new Error(msg.replace(/^(USER_LIMIT|NOT_MEMBER|CONFIG): ?/, '').replace(/^./, (c) => c.toUpperCase()));
    if (/API key not valid|API_KEY_INVALID/i.test(msg)) throw new Error('Gemini: la API key no es válida. Copiala de nuevo desde aistudio.google.com/app/apikey (sin espacios).');
    if (/thinking/i.test(msg) && ti < THINK_LEVELS.length - 1) { ti++; continue; }

    const busy = res.status === 503 || res.status === 500 || /high demand|overloaded|unavailable|try again later/i.test(msg);
    const quota = res.status === 429 || /quota|rate limit|exhausted/i.test(msg);
    if (busy || quota) {
      lastKind = busy ? 'busy' : 'quota';
      if (busy && !retriedBusy) { retriedBusy = true; await wait(700); continue; }
      const next = nextBackup();
      if (next) { model = next; tried.add(next); ti = thinkFor(next); continue; }
      break;
    }

    const suggested = msg.match(/models\/(gemini-[\w.-]+)/g)?.map((m) => m.slice(7)).find((m) => m !== model);
    if (res.status === 404 || /no longer available|not found|not supported/i.test(msg)) {
      const next = (!modelSwitched && suggested && !tried.has(suggested) && suggested)
        || (!tried.has(DEFAULT_MODEL) && DEFAULT_MODEL)
        || nextBackup();
      if (next) { model = next; tried.add(next); modelSwitched = true; ti = thinkFor(next); continue; }
    }
    throw new Error('Gemini: ' + msg);
  }
  if (lastKind === 'busy') throw new Error('Gemini está saturado en este momento (le pasa a todos, no es tu cuenta). Probá de nuevo en un minuto.');
  if (lastKind === 'quota') throw new Error('Gemini: alcanzaste el límite gratuito por ahora. Se renueva solo; probá en un rato.');
  throw new Error('Gemini: ' + (lastMsg || 'no encontré un modelo disponible. Revisá el campo Modelo en Perfil.'));
}

const partsText = (j) => (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');

export async function callGemini(profile, body) {
  const res = await request(profile, body, false);
  const text = partsText(await res.json());
  if (!text) throw new Error('La IA no devolvió resultados. Probá reformularlo.');
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

// Respuesta en vivo: llama a onText con el texto acumulado a medida que llega.
export async function streamGemini(profile, body, onText) {
  const res = await request(profile, body, true);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      try { full += partsText(JSON.parse(line.slice(5))); onText(full); } catch {}
    }
  }
  if (!full) throw new Error('La IA no respondió. Probá reformular la pregunta.');
  return full;
}

function gemini(profile, parts, schema, temperature = 0.2) {
  return callGemini(profile, {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
  });
}

const clean = (it) => ({
  name: it.name,
  grams: Math.max(1, r0(it.grams)),
  kcal: r1(it.kcal), protein: r1(it.protein), carbs: r1(it.carbs), fat: r1(it.fat), fiber: r1(it.fiber || 0),
});

// Convierte un ítem con valores totales en un alimento por 100 g.
export function itemToFood(it, source = 'ai') {
  const k = 100 / (it.grams || 100);
  return {
    name: it.name, kcal: it.kcal * k, protein: it.protein * k, carbs: it.carbs * k, fat: it.fat * k,
    fiber: (it.fiber || 0) * k, source,
  };
}

export async function analyzeText(profile, text) {
  const out = await gemini(profile, [{ text: `Desglosá en alimentos individuales lo que comí y estimá gramos y macros de cada uno:\n\n"${text}"` }], ITEMS_SCHEMA);
  return { items: (out.items || []).map(clean), notes: out.notes || '' };
}

export async function analyzePhoto(profile, { base64, mime }, note) {
  const parts = [
    { inlineData: { mimeType: mime, data: base64 } },
    { text: `Identificá cada alimento visible en la foto, estimá los gramos de cada uno según el tamaño aparente (plato estándar de 26 cm) y calculá sus macros.${note ? `\nAclaración: ${note}` : ''}` },
  ];
  const out = await gemini(profile, parts, ITEMS_SCHEMA);
  return { items: (out.items || []).map(clean), notes: out.notes || '' };
}

export async function parseRecipe(profile, text) {
  const out = await gemini(profile, [{ text: `Convertí esta receta en una lista de ingredientes CRUDOS con gramos y macros totales de cada uno (usá gramos aunque la receta diga tazas/cucharadas):\n\n${text}` }], ITEMS_SCHEMA);
  return { items: (out.items || []).map(clean), notes: out.notes || '' };
}

export async function aiMealPlan(profile, mealTargets) {
  const lines = mealTargets
    .map((m) => `- ${m.id}: ${r0(m.kcal)} kcal, ${r0(m.protein)} g proteína, ${r0(m.carbs)} g carbohidratos, ${r0(m.fat)} g grasa`)
    .join('\n');
  const prompt = `Armá un plan de comidas para UN día, con comidas caseras argentinas, simples y ricas, que cumpla estos objetivos por comida (tolerancia ±5%):
${lines}
${profile.planExclude ? `\nNO incluir: ${profile.planExclude}` : ''}${profile.planNotes ? `\nPreferencias: ${profile.planNotes}` : ''}
Usá alimentos en peso listo para comer (cocido) salvo avena, y en "meal" usá exactamente el id de la comida (${mealTargets.map((m) => m.id).join(', ')}). En "title" poné un nombre corto para el plato.`;
  const out = await gemini(profile, [{ text: prompt }], PLAN_SCHEMA, 0.8);
  return (out.meals || []).map((m) => ({ meal: m.meal, title: m.title || '', items: (m.items || []).map(clean) }));
}

// Reduce la foto antes de enviarla (más rápido y gasta menos cuota).
export function fileToBase64(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(url);
      resolve({ base64: dataUrl.split(',')[1], mime: 'image/jpeg', preview: dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No pude leer la imagen')); };
    img.src = url;
  });
}

// ---------- Nutricionista IA (chat, en vivo) ----------
const COACH_SYSTEM = `Sos "Prime Coach", nutricionista deportiva con formación clínica: experta en nutrición deportiva (hipertrofia, recomposición, pérdida de grasa preservando músculo, timing de nutrientes, suplementación con evidencia: creatina, whey, cafeína) y en nutrición general (micronutrientes, fibra, saciedad, hidratación, alimentación para trabajos por turnos/guardias, comer afuera, alcohol).
Hablás en español rioplatense, directo y práctico, como un buen nutricionista que conoce al paciente. Basás todo en evidencia actual (ISSN, ACSM, guías alimentarias argentinas) y en los datos del usuario que te paso abajo.

Cómo respondés:
- Para "¿puedo comer X?": decidí con los macros y calorías QUE LE QUEDAN HOY, el tipo de día (guardia/franco), su plan y sus reglas. Dá un veredicto claro y, si es "moderacion", decí la porción exacta (en gramos o unidades) y cómo compensar en el resto del día.
- Usá números concretos (kcal y gramos de proteína/carbos/grasa). Estimá con tablas de composición y porciones argentinas.
- Respetá sus reglas: 1 comida libre por semana, proteína en todas las comidas, sin dulces ni harinas fuera de la comida libre. Si pide algo que rompe una regla, decilo sin sermonear y ofrecé la mejor alternativa.
- Sé breve: 2 a 6 oraciones o una lista corta. Podés usar **negrita** y viñetas con "- ".

FORMATO OBLIGATORIO:
- La PRIMERA línea es solo una etiqueta: [SI] (encaja bien), [MODERACION] (sí, con porción/ajuste), [NO] (mejor no hoy) o [INFO] (pregunta general).
- Después, la respuesta.
- Si sugerís algo concreto para comer, terminá con una última línea que empiece con ITEMS: seguida de un JSON en una sola línea, por ejemplo: ITEMS: [{"name":"Pizza de muzzarella","grams":240,"kcal":648,"protein":26,"carbs":72,"fat":28}] (valores TOTALES de esa porción). Si no sugerís nada, no pongas esa línea.
- Si menciona síntomas, enfermedades, medicación, embarazo o señales de trastorno alimentario, dá información general prudente y recomendá consultar a un médico o nutricionista matriculado.`;

const VERDICT_RE = /^\s*\[(SI|SÍ|MODERACION|MODERACIÓN|NO|INFO)\]\s*/i;
export function parseCoach(raw, final) {
  let text = raw, verdict = 'info', items = [];
  const m = text.match(VERDICT_RE);
  if (m) { verdict = { si: 'si', 'sí': 'si', moderacion: 'moderacion', 'moderación': 'moderacion', no: 'no' }[m[1].toLowerCase()] || 'info'; text = text.slice(m[0].length); }
  else if (!final && /^\s*\[?[A-ZÍÓ]{0,10}$/.test(text)) text = '';
  const ii = text.search(/\n?\s*ITEMS:/);
  if (ii >= 0) {
    const json = text.slice(ii).replace(/^\s*ITEMS:\s*/, '');
    text = text.slice(0, ii);
    if (final) { try { items = JSON.parse(json).map(clean); } catch {} }
  }
  return { verdict, text: text.trim(), items };
}

export async function askCoach(profile, context, history, { text, photo }, onPartial) {
  const contents = history.slice(-12).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.role === 'user' ? (m.text || '(foto)') : m.text }],
  }));
  const parts = [];
  if (photo) parts.push({ inlineData: { mimeType: photo.mime, data: photo.base64 } });
  parts.push({ text: text || '¿Puedo comer esto?' });
  contents.push({ role: 'user', parts });
  const raw = await streamGemini(profile, {
    systemInstruction: { parts: [{ text: `${COACH_SYSTEM}\n\n--- DATOS DEL USUARIO (actualizados) ---\n${context}` }] },
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 900 },
  }, (t) => onPartial?.(parseCoach(t, false)));
  return parseCoach(raw, true);
}

// ---------- Plan de entrenamiento + comida armado por la IA ----------
const TASK = { type: 'OBJECT', properties: { title: { type: 'STRING' }, detail: { type: 'STRING' } }, required: ['title'] };
const TRAINING_PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    routines: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      key: { type: 'STRING' }, name: { type: 'STRING' }, focus: { type: 'STRING' },
      exercises: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, sets: { type: 'STRING' } }, required: ['name', 'sets'] } },
    }, required: ['key', 'name', 'exercises'] } },
    week: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      day: { type: 'INTEGER' }, label: { type: 'STRING' },
      kind: { type: 'STRING', enum: ['gym', 'cardio', 'rest', 'active'] },
      routine: { type: 'STRING' }, tasks: { type: 'ARRAY', items: TASK },
    }, required: ['day', 'label', 'kind'] } },
    meals: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      key: { type: 'STRING', enum: ['des', 'alm', 'mer', 'cen'] }, options: { type: 'ARRAY', items: TASK },
    }, required: ['key', 'options'] } },
    habits: { type: 'ARRAY', items: TASK },
    sections: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      title: { type: 'STRING' }, text: { type: 'STRING' },
      rows: { type: 'ARRAY', items: { type: 'OBJECT', properties: { a: { type: 'STRING' }, b: { type: 'STRING' } }, required: ['a'] } },
    }, required: ['title'] } },
    shopping: { type: 'ARRAY', items: { type: 'OBJECT', properties: { category: { type: 'STRING' }, items: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['category', 'items'] } },
    rules: { type: 'ARRAY', items: { type: 'STRING' } },
    tips: { type: 'STRING' },
  },
  required: ['name', 'routines', 'week', 'meals', 'habits', 'sections', 'shopping', 'rules', 'tips'],
};

export async function generateTrainingPlan(profile, targets, { routine, photo, schedule, food, goalText }) {
  const who = [
    `Sexo: ${profile.sex === 'f' ? 'mujer' : 'hombre'}. Peso: ${profile.weight || '?'} kg. Altura: ${profile.height || '?'} cm. Fecha de nacimiento: ${profile.birthdate || '?'}.`,
    targets ? `Objetivo diario: ${targets.kcal} kcal · proteína ${targets.protein} g · carbohidratos ${targets.carbs} g · grasas ${targets.fat} g.` : '',
    profile.primeWeight ? `Meta de peso: ${profile.primeWeight} kg.` : '',
    goalText ? `Objetivo personal: ${goalText}` : '',
    schedule ? `Horarios y días disponibles: ${schedule}` : '',
    food ? `Comidas, gustos y restricciones: ${food}` : '',
    profile.planExclude ? `No come: ${profile.planExclude}.` : '',
  ].filter(Boolean).join('\n');
  const prompt = `Armá el plan semanal completo de esta persona: entrenamiento + comida + hábitos, práctico y fácil de seguir, con productos de supermercado argentino.

DATOS:
${who}

RUTINA QUE ME PASÓ (respetala: mismos ejercicios y series; si falta algo, completalo con criterio):
${routine || '(no pasó rutina: proponé una acorde a su objetivo y días disponibles)'}

INSTRUCCIONES:
- routines: cada rutina/día de gym con key corta (ej "A", "B", "piernas"), name corto, focus (grupos musculares) y exercises con sets en formato "4×12" o similar.
- week: exactamente 7 elementos, day 0=domingo … 6=sábado. kind "gym" (con routine = key), "cardio", "active" (caminar, yoga, deporte) o "rest". label corto (ej "Glúteos", "Descanso", "Cardio suave"). tasks: 1–3 tareas concretas del día además del gym (pasos, cardio, movilidad, preparar viandas…).
- meals: para des, alm, mer y cen, 4 a 7 opciones distintas que roten; title = el plato con porciones (ej "Omelette de 2 huevos + 1 tostada integral + fruta"), detail = tip corto. Las porciones tienen que sumar aprox. el objetivo diario y repartir la proteína en las 4 comidas.
- habits: 2–4 hábitos diarios (agua, sin ultraprocesados, horas de sueño…).
- sections: 3–6 tarjetas para "Mi sistema": cómo organizar la semana, qué cocinar por adelantado (meal prep), opciones para comer afuera, colaciones rápidas, plan B. rows son pares a/b cortos.
- shopping: lista de compras semanal agrupada por categoría con cantidades.
- rules: 4–7 reglas cortas y motivadoras.
- tips: un párrafo con progresión de cargas, descansos y cardio.
- name: nombre corto y motivador para el plan.`;
  const parts = [];
  if (photo) parts.push({ inlineData: { mimeType: photo.mime, data: photo.base64 } });
  parts.push({ text: prompt });
  return callGemini(profile, {
    systemInstruction: { parts: [{ text: 'Sos entrenador personal y nutricionista deportivo argentino. Respondés en español rioplatense, con planes realistas, seguros y basados en evidencia.' }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: TRAINING_PLAN_SCHEMA, temperature: 0.6 },
  });
}

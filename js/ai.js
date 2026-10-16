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
    { text: `Analizá esta foto de comida como nutricionista que estima porciones a ojo con mucha práctica:
1. Identificá CADA alimento por separado (también salsas, aderezos, pan, bebidas) y cómo está cocinado (frito, al horno, a la plancha, hervido).
2. Estimá los gramos de cada uno usando referencias de la foto: plato llano estándar ≈ 26 cm, plato de postre ≈ 20 cm, tenedor ≈ 20 cm, cuchara sopera ≈ 15 ml, mano adulta, lata ≈ 7 cm de diámetro, vaso ≈ 250 ml. Pensá en volumen y densidad (una taza de arroz cocido ≈ 160 g; una pechuga mediana ≈ 150 g).
3. Sumá el aceite o la manteca que probablemente se usó para cocinar (ej. frito ≈ +10–15 g de aceite).
4. Calculá kcal y macros TOTALES de cada porción con tablas de composición (USDA / ARGENFOODS) y porciones típicas de Argentina.
En "notes" contá en una frase qué referencia usaste y si hay algo dudoso.${note ? `\nAclaración de la persona: ${note}` : ''}` },
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
const COACH_SYSTEM = `Sos "Split Coach", la nutricionista de la persona: experta en nutrición deportiva (hipertrofia, recomposición, pérdida de grasa cuidando el músculo, timing de comidas, suplementos con evidencia como creatina, whey y cafeína) y en nutrición general (micronutrientes, fibra, saciedad, hidratación, horarios cambiantes, comer afuera, alcohol). Te basás en evidencia actual (ISSN, ACSM, guías alimentarias argentinas) y en los datos de la persona que te paso abajo.

CÓMO HABLÁS:
- Como en una charla por chat con alguien que te cae bien: cálida, directa, natural, en español rioplatense. Tuteo con "vos".
- Escribís en prosa, en 1 a 3 párrafos cortos. NUNCA uses listas, viñetas, guiones, numeraciones, títulos ni formato de informe.
- Metés los números dentro de las frases ("te quedan unas 900 kcal, así que dos porciones entran justo"). Podés usar **negrita** solo para el dato clave.
- Para "¿puedo comer X?": decidí con lo que LE QUEDA HOY, su entrenamiento y sus reglas. Si es con moderación, decí la porción concreta y cómo compensar el resto del día.
- Si pide algo que rompe una regla suya, decíselo sin sermonear y proponé la mejor alternativa.
- Si menciona síntomas, enfermedades, medicación, embarazo o señales de trastorno alimentario, dale información general prudente y sugerile consultar a un médico o nutricionista matriculado.

FORMATO OBLIGATORIO:
- La PRIMERA línea es solo una etiqueta: [SI] (encaja bien), [MODERACION] (sí, con porción/ajuste), [NO] (mejor no hoy) o [INFO] (pregunta general).
- Después, tu respuesta en prosa.
- Si sugerís algo concreto para comer, terminá con una última línea que empiece con ITEMS: seguida de un JSON en una sola línea, por ejemplo: ITEMS: [{"name":"Pizza de muzzarella","grams":240,"kcal":648,"protein":26,"carbs":72,"fat":28}] (valores TOTALES de esa porción). Si no sugerís nada, no pongas esa línea.`;

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

// ---------- Entrenador IA: arma la semana de entrenamiento ----------
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
    tips: { type: 'STRING' },
  },
  required: ['name', 'routines', 'week', 'tips'],
};

export async function generateTrainingPlan(profile, targets, { routine, photo, schedule, goalText, nutrition }) {
  const who = [
    `Sexo: ${profile.sex === 'f' ? 'mujer' : 'hombre'}. Peso: ${profile.weight || '?'} kg. Altura: ${profile.height || '?'} cm.`,
    goalText ? `Objetivo: ${goalText}` : '',
    schedule ? `Días, horarios y condiciones: ${schedule}` : '',
    nutrition ? `Ya tiene plan de comida de su nutricionista: ${nutrition.targets?.kcal || targets?.kcal || '?'} kcal/día, proteína ${nutrition.targets?.protein || targets?.protein || '?'} g (plan "${nutrition.name}"). Armá el entrenamiento coherente con eso.` : '',
  ].filter(Boolean).join('\n');
  const prompt = `Armá la semana de ENTRENAMIENTO de esta persona (solo entrenamiento: nada de comidas).

DATOS:
${who}

RUTINA QUE ME PASÓ (respetala: mismos ejercicios y series; si falta algo, completalo con criterio):
${routine || '(no pasó rutina: diseñala vos según objetivo, días, tiempo, nivel y equipamiento)'}

INSTRUCCIONES:
- routines: cada día de gym con key corta (ej "A", "B", "piernas"), name corto, focus (grupos musculares) y 5–9 exercises con sets en formato "4×10".
- week: exactamente 7 elementos, day 0=domingo … 6=sábado. kind "gym" (con routine = key), "cardio", "active" (caminar, yoga, deporte) o "rest". label corto. tasks: 0–2 tareas de entrenamiento del día además del gym (pasos, cardio, movilidad). Nada de comida.
- tips: un párrafo con progresión de cargas, descansos y cardio.
- name: nombre corto y motivador.`;
  const parts = [];
  if (photo) parts.push({ inlineData: { mimeType: photo.mime, data: photo.base64 } });
  parts.push({ text: prompt });
  return callGemini(profile, {
    systemInstruction: { parts: [{ text: TRAINER_SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: TRAINING_PLAN_SCHEMA, temperature: 0.6 },
  });
}

// ---------- Nutricionista IA: calorías + plan de comida según el objetivo ----------
const NUTRITION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    targets: { type: 'OBJECT', properties: { kcal: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, carbs: { type: 'NUMBER' }, fat: { type: 'NUMBER' } }, required: ['kcal', 'protein', 'carbs', 'fat'] },
    explanation: { type: 'STRING' },
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
  },
  required: ['name', 'targets', 'explanation', 'meals', 'habits', 'sections', 'shopping', 'rules'],
};

export async function generateNutritionPlan(profile, ref, { goal, detail, mealsPerDay, likes, cooking, notes, training }) {
  const prompt = `Armá el plan de alimentación de esta persona según su objetivo.

DATOS: ${profile.sex === 'f' ? 'mujer' : 'hombre'}, ${profile.birthdate ? `nacida/o el ${profile.birthdate}` : 'edad ?'}, ${profile.height || '?'} cm, ${profile.weight || '?'} kg${profile.bodyfat ? `, ${profile.bodyfat}% grasa` : ''}. Actividad: ${profile.activity || 'moderada'}.
OBJETIVO: ${goal}${detail ? ` — ${detail}` : ''}.
${training ? `ENTRENAMIENTO: ${training}` : ''}
${ref ? `REFERENCIA calculada (Mifflin-St Jeor): mantenimiento ≈ ${ref.tdee} kcal; con el objetivo actual del perfil ≈ ${ref.kcal} kcal. Usala como punto de partida y ajustá con criterio profesional.` : ''}
Comidas por día: ${mealsPerDay || 4}. Gustos / no come / alergias: ${likes || 'sin restricciones'}. Tiempo para cocinar: ${cooking || 'normal'}.
${notes ? `Notas: ${notes}` : ''}

INSTRUCCIONES:
- targets: calorías y macros diarios (g) para lograr el objetivo de forma sostenible. Proteína 1,6–2,2 g/kg según objetivo; grasa ≥ 0,7 g/kg; el resto carbohidratos. Para bajar grasa, déficit moderado (300–500 kcal); para ganar músculo, superávit chico (200–300 kcal).
- explanation: 2–4 oraciones en prosa, cálidas y simples, explicando por qué esas calorías y macros (sin tecnicismos innecesarios).
- meals: para des, alm, mer y cen (si come menos comidas, igual dá opciones para las 4 y aclaralo), 4 a 7 opciones distintas que roten; title = el plato con porciones concretas (ej "Omelette de 2 huevos + 1 tostada integral + fruta"), detail = tip corto. Que sumen aprox. los targets y repartan la proteína.
- habits: 2–4 hábitos diarios (agua, sueño, verduras…).
- sections: 3–6 tarjetas prácticas: cómo organizar la semana, qué cocinar por adelantado, comer afuera, colaciones rápidas, plan B.
- shopping: lista de compras semanal por categoría con cantidades, productos de supermercado argentino.
- rules: 4–6 reglas cortas y motivadoras.
- name: nombre corto del plan.`;
  return callGemini(profile, {
    systemInstruction: { parts: [{ text: 'Sos nutricionista deportiva y clínica argentina. Basás tus recomendaciones en evidencia (ISSN, guías alimentarias argentinas) y las explicás simple. Respondés en español rioplatense.' }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: NUTRITION_SCHEMA, temperature: 0.5 },
  });
}

// ---------- Entrenador IA: crear o mejorar rutinas ----------
const ROUTINES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    routines: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, focus: { type: 'STRING' },
      exercises: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, sets: { type: 'STRING' } }, required: ['name', 'sets'] } },
    }, required: ['name', 'focus', 'exercises'] } },
    tips: { type: 'STRING' },
  },
  required: ['routines', 'tips'],
};

const TRAINER_SYSTEM = `Sos entrenador personal certificado (NSCA/ACSM) con 15 años de experiencia en hipertrofia, fuerza y recomposición corporal. Diseñás rutinas de gimnasio seguras, eficientes y basadas en evidencia: volumen semanal adecuado por grupo muscular (10–20 series efectivas), frecuencia 2x por músculo cuando se puede, ejercicios compuestos primero, progresión de cargas, RIR 1–3 y descansos acordes. Respondés en español rioplatense, con nombres de ejercicios como se dicen en los gimnasios de Argentina.`;

export async function generateRoutines(profile, { mode, goal, days, minutes, level, equipment, notes, current }) {
  const cur = (current || []).map((r) => `- ${r.name}${r.full ? ` (${r.full})` : ''}: ${r.ex.map((e) => `${e[0]} ${e[1] || ''}`.trim()).join('; ')}`).join('\n');
  const prompt = `${mode === 'improve' ? 'Rediseñá por completo la rutina actual de esta persona' : 'Armá una rutina de gimnasio nueva para esta persona'}.

PERSONA: ${profile.sex === 'f' ? 'mujer' : 'hombre'}, ${profile.weight || '?'} kg, ${profile.height || '?'} cm.
Objetivo: ${goal || 'mejorar composición corporal'}.
Días de gym por semana: ${days || 4}. Tiempo por sesión: ${minutes || 60} min. Nivel: ${level || 'intermedio'}.
Equipamiento: ${equipment || 'gimnasio completo'}.
${notes ? `Notas / lesiones / gustos: ${notes}` : ''}
${cur ? `\nRUTINA ACTUAL:\n${cur}\n${mode === 'improve' ? `Mantené el mismo esquema de días pero subí el nivel según lo pedido (${level || 'mismo nivel'}): más estímulo, mejor selección de ejercicios, técnicas de intensidad si corresponde.` : ''}` : ''}

Devolvé exactamente ${days || 4} rutinas (una por día de gym, en el orden en que se hacen). Cada una: name corto (ej "Push", "Pull", "Glúteos"), focus (grupos musculares), y 5–9 ejercicios con sets en formato "4×8-10" o "3×12 + dropset". Que entren en ${minutes || 60} minutos. En tips: progresión de cargas, descansos y cardio, en un párrafo.`;
  const out = await callGemini(profile, {
    systemInstruction: { parts: [{ text: TRAINER_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: ROUTINES_SCHEMA, temperature: 0.6 },
  });
  return out;
}

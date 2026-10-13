// IA con Google Gemini (API gratuita de Google AI Studio). La key se guarda en tu perfil.
import { r0, r1 } from './util.js';

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
  return Boolean(profile?.geminiKey);
}

const MODEL_KEY = 'prime:aiModelOk';
const savedModel = () => { try { return localStorage.getItem(MODEL_KEY); } catch { return null; } };

// Llama a Gemini. Si Google retiró el modelo, usa el que Google recomienda en el error y lo recuerda.
export async function callGemini(profile, body) {
  const key = (profile?.geminiKey || '').trim();
  if (!key) throw new Error('Falta tu API key de Gemini (Perfil → IA).');
  let model = (profile.aiModel || '').trim() || savedModel() || DEFAULT_MODEL;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      try { localStorage.setItem(MODEL_KEY, model); } catch {}
      const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      if (!text) throw new Error('La IA no devolvió resultados. Probá reformularlo.');
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    }
    const msg = j.error?.message || `Error ${res.status}`;
    if (res.status === 429) throw new Error('Gemini: alcanzaste el límite gratuito por minuto/día. Probá en un rato.');
    if (/API key not valid|API_KEY_INVALID/i.test(msg)) throw new Error('Gemini: la API key no es válida. Copiala de nuevo desde aistudio.google.com/app/apikey (sin espacios).');
    const suggested = msg.match(/models\/(gemini-[\w.-]+)/g)?.map((m) => m.slice(7)).find((m) => m !== model);
    if (attempt === 0 && (res.status === 404 || /no longer available|not found|not supported/i.test(msg))) {
      model = suggested || (model === DEFAULT_MODEL ? null : DEFAULT_MODEL);
      if (model) continue;
    }
    throw new Error('Gemini: ' + msg);
  }
  throw new Error('Gemini: no encontré un modelo disponible. Revisá el campo Modelo en Perfil.');
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

// ---------- Nutricionista IA (chat) ----------
const COACH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', enum: ['si', 'moderacion', 'no', 'info'] },
    answer: { type: 'STRING' },
    items: { type: 'ARRAY', items: ITEM },
  },
  required: ['verdict', 'answer'],
};

const COACH_SYSTEM = `Sos "Prime Coach", nutricionista deportiva con formación clínica: experta en nutrición deportiva (hipertrofia, recomposición, pérdida de grasa preservando músculo, timing de nutrientes, suplementación con evidencia: creatina, whey, cafeína) y en nutrición general (micronutrientes, fibra, saciedad, hidratación, alimentación para trabajos por turnos/guardias, comer afuera, alcohol).
Hablás en español rioplatense, directo y práctico, como un buen nutricionista que conoce al paciente. Basás todo en evidencia actual (ISSN, ACSM, guías alimentarias argentinas) y en los datos del usuario que te paso abajo.

Cómo respondés:
- Para "¿puedo comer X?": decidí con los macros y calorías QUE LE QUEDAN HOY, el tipo de día (guardia/franco), su plan y sus reglas. Dá un veredicto claro y, si es "moderacion", decí la porción exacta (en gramos o unidades) y cómo compensar en el resto del día.
- Usá números concretos (kcal y gramos de proteína/carbos/grasa). Estimá con tablas de composición y porciones argentinas.
- Respetá sus reglas: 1 comida libre por semana, proteína en todas las comidas, sin dulces ni harinas fuera de la comida libre. Si pide algo que rompe una regla, decilo sin sermonear y ofrecé la mejor alternativa.
- Sé breve: 2 a 6 oraciones o una lista corta. Podés usar **negrita** y viñetas con "- ".
- Si sugerís algo concreto para comer, cargalo en "items" con gramos y macros TOTALES de esa porción para que lo pueda registrar. Si no, dejá "items" vacío.
- verdict: "si" (encaja bien), "moderacion" (sí, con porción/ajuste), "no" (mejor no hoy), "info" (pregunta general sin veredicto).
- Si menciona síntomas, enfermedades, medicación, embarazo o señales de trastorno alimentario, dá información general prudente y recomendá consultar a un médico o nutricionista matriculado.`;

export async function askCoach(profile, context, history, { text, photo }) {
  const contents = history.slice(-12).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.role === 'user' ? (m.text || '(foto)') : m.text }],
  }));
  const parts = [];
  if (photo) parts.push({ inlineData: { mimeType: photo.mime, data: photo.base64 } });
  parts.push({ text: text || '¿Puedo comer esto?' });
  contents.push({ role: 'user', parts });

  const out = await callGemini(profile, {
    systemInstruction: { parts: [{ text: `${COACH_SYSTEM}\n\n--- DATOS DEL USUARIO (actualizados) ---\n${context}` }] },
    contents,
    generationConfig: { responseMimeType: 'application/json', responseSchema: COACH_SCHEMA, temperature: 0.4 },
  });
  return { verdict: out.verdict || 'info', text: out.answer || '', items: (out.items || []).map(clean) };
}

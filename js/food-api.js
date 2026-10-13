// Búsqueda en bases de datos abiertas: Open Food Facts (productos/códigos de barras) y USDA FoodData Central.
import { BASE_FOODS } from './foods-db.js';
import { norm, r1 } from './util.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const OFF_FIELDS = 'code,product_name,product_name_es,brands,nutriments,serving_quantity,serving_size';

function fromOFF(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184;
  const name = (p.product_name_es || p.product_name || '').trim();
  if (!name || kcal == null) return null;
  return {
    key: 'off:' + p.code,
    name,
    brand: (Array.isArray(p.brands) ? p.brands[0] : (p.brands || '').split(',')[0])?.trim() || null,
    barcode: p.code,
    kcal: r1(kcal),
    protein: r1(n.proteins_100g),
    carbs: r1(n.carbohydrates_100g),
    fat: r1(n.fat_100g),
    fiber: r1(n.fiber_100g),
    serving_g: +p.serving_quantity > 0 ? +p.serving_quantity : null,
    serving_label: p.serving_size || (p.serving_quantity ? 'porción' : null),
    unit: +p.serving_quantity > 0,
    source: 'off',
  };
}

// Con Supabase configurado se usa la Edge Function "food-search" (buscador nuevo de OFF, más confiable).
async function searchViaProxy(q, signal) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/food-search?q=${encodeURIComponent(q)}`, {
    signal, headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error('proxy ' + res.status);
  const j = await res.json();
  return rank(q, (j.hits || []).map(fromOFF).filter(Boolean));
}

export async function searchOFF(q, signal) {
  if (SUPABASE_URL) {
    try { return await searchViaProxy(q, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=40&lc=es&sort_by=unique_scans_n&fields=${OFF_FIELDS}`;
  // El buscador de OFF a veces se satura (503): reintento una vez.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error('Open Food Facts está saturado en este momento.');
      const j = await res.json();
      return rank(q, (j.products || []).map(fromOFF).filter(Boolean));
    } catch (e) {
      if (e.name === 'AbortError' || attempt >= 1) throw e.name === 'AbortError' ? e : new Error('Open Food Facts está saturado en este momento.');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

// Prioriza productos cuyo nombre contiene todas las palabras buscadas (y los de Argentina/español).
function rank(q, items) {
  const toks = norm(q).split(/\s+/).filter((t) => t.length > 1);
  const score = (f) => {
    const name = norm(f.name), hay = norm(`${f.name} ${f.brand || ''}`);
    const hits = toks.filter((t) => hay.includes(t)).length;
    return hits * 10 + (toks.every((t) => name.includes(t)) ? 15 : 0) + (name.startsWith(toks[0] || '') ? 5 : 0);
  };
  return items.map((f, i) => [score(f) - i * 0.01, f]).sort((a, b) => b[0] - a[0]).map((x) => x[1]).slice(0, 24);
}

export async function lookupBarcode(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Open Food Facts no respondió');
  const j = await res.json();
  if (j.status !== 1 || !j.product) return null;
  return fromOFF({ ...j.product, code }) || { partial: true, name: j.product.product_name || '', brand: j.product.brands || '', barcode: code };
}

const NUTR = { kcal: [1008, 2047, 2048], protein: [1003], carbs: [1005], fat: [1004], fiber: [1079] };
function nutr(list, ids) {
  for (const id of ids) {
    const x = list.find((n) => n.nutrientId === id);
    if (x && x.value != null) return x.value;
  }
  return null;
}

export async function searchUSDA(q, apiKey, signal) {
  const key = apiKey || 'DEMO_KEY';
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&pageSize=20&dataType=Foundation,SR%20Legacy`;
  const res = await fetch(url, { signal });
  if (res.status === 429) throw new Error('USDA: límite de consultas alcanzado. Cargá tu propia API key gratis en Perfil.');
  if (!res.ok) throw new Error('USDA no respondió');
  const j = await res.json();
  return (j.foods || []).map((f) => {
    const ns = f.foodNutrients || [];
    const protein = nutr(ns, NUTR.protein) || 0, carbs = nutr(ns, NUTR.carbs) || 0, fat = nutr(ns, NUTR.fat) || 0;
    const kcal = nutr(ns, NUTR.kcal) ?? protein * 4 + carbs * 4 + fat * 9;
    return {
      key: 'usda:' + f.fdcId,
      name: f.description.charAt(0) + f.description.slice(1).toLowerCase(),
      kcal: r1(kcal), protein: r1(protein), carbs: r1(carbs), fat: r1(fat), fiber: r1(nutr(ns, NUTR.fiber)),
      serving_g: null, serving_label: null, source: 'usda',
    };
  }).filter((f) => f.kcal > 0 || f.protein || f.carbs || f.fat);
}

// Búsqueda local instantánea (base AR + mis alimentos + recetas), tolerante a tildes.
export function searchLocal(q, extra = []) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const all = [...extra, ...BASE_FOODS];
  const scored = [];
  for (const f of all) {
    const hay = norm(`${f.name} ${f.brand || ''}`);
    if (!toks.every((t) => hay.includes(t))) continue;
    let s = 0;
    if (hay.startsWith(toks[0])) s += 3;
    if (hay.split(/[\s(]/).includes(toks[0])) s += 2;
    if (f.source !== 'base') s += 2;
    s -= hay.length / 100;
    scored.push([s, f]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map((x) => x[1]).slice(0, 40);
}

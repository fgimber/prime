// Generador automático de plan de comidas: elige combinaciones de alimentos y
// ajusta los gramos (mínimos cuadrados con límites) para encajar en tus macros.
import { BASE_FOODS } from './foods-db.js';
import { norm, snapshot, macrosFor, sum, r0 } from './util.js';
import { mealTarget } from './nutrition.js';

const KEYS = ['protein', 'carbs', 'fat', 'kcal'];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function solve(cands, target, fixedMacros) {
  const rem = KEYS.map((k) => target[k] - fixedMacros[k]);
  const w = KEYS.map((k) => (k === 'kcal' ? 3 : 1) / Math.max(Math.abs(target[k]), k === 'kcal' ? 100 : 8) ** 2);
  const A = KEYS.map((k) => cands.map((c) => (c[k] || 0) / 100));
  const x = cands.map((c) => Math.min(c.max, 80));
  for (let it = 0; it < 250; it++) {
    for (let j = 0; j < x.length; j++) {
      let nu = 0, de = 0;
      for (let k = 0; k < KEYS.length; k++) {
        let r = -rem[k];
        for (let m = 0; m < x.length; m++) r += A[k][m] * x[m];
        nu += w[k] * A[k][j] * r;
        de += w[k] * A[k][j] ** 2;
      }
      if (de > 0) x[j] = Math.min(cands[j].max, Math.max(0, x[j] - nu / de));
    }
  }
  return x;
}

function roundGrams(food, g) {
  if (food.unit && food.serving_g) return Math.round(g / food.serving_g) * food.serving_g;
  if (g < 30) return Math.round(g);
  return Math.round(g / 5) * 5;
}

function score(items, target) {
  const t = sum(items.map((i) => macrosFor(i.food, i.grams)));
  return KEYS.reduce((a, k) => a + ((t[k] - target[k]) / Math.max(target[k], k === 'kcal' ? 100 : 8)) ** 2 * (k === 'kcal' ? 3 : 1), 0);
}

export function poolFor(profile) {
  const ex = norm(profile?.planExclude || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  return BASE_FOODS.filter((f) => f.tags.length && !ex.some((e) => norm(f.name).includes(e)));
}

export function generateMeal(mealId, target, pool, avoid = new Set()) {
  const kind = mealId === 'almuerzo' || mealId === 'cena' ? 'm' : 'b';
  const byTag = (t) => {
    const all = pool.filter((f) => f.tags.includes(t));
    const fresh = all.filter((f) => !avoid.has(f.key));
    return fresh.length ? fresh : all;
  };
  const P = byTag('p' + kind), C = byTag('c' + kind), F = byTag('f' + kind), V = byTag('v');
  if (!P.length || !C.length) return { meal: mealId, items: [] };

  const results = [];
  for (let trial = 0; trial < 36; trial++) {
    const fixed = [];
    if (kind === 'm' && V.length) {
      const v = rand(V);
      fixed.push({ food: v, grams: v.serving_g >= 150 ? v.serving_g : 150 });
    }
    const picks = [rand(P), rand(C)];
    if (F.length && Math.random() < 0.85) picks.push(rand(F));
    // a veces un segundo carbohidrato (ej. avena + banana)
    if (kind === 'b' && Math.random() < 0.4) {
      const c2 = rand(C);
      if (!picks.includes(c2)) picks.push(c2);
    }
    const fm = sum(fixed.map((i) => macrosFor(i.food, i.grams)));
    const g = solve(picks, target, fm);
    const items = [...fixed];
    picks.forEach((f, i) => {
      const gr = roundGrams(f, g[i]);
      if (gr >= (f.tags.some((t) => t[0] === 'f') ? 5 : 15)) items.push({ food: f, grams: gr });
    });
    results.push({ items, err: score(items, target) });
  }
  results.sort((a, b) => a.err - b.err);
  const best = rand(results.slice(0, 4));
  return {
    meal: mealId,
    items: best.items.map((i) => ({ food: snapshot(i.food), grams: i.grams })),
  };
}

export function generateDay(targets, meals, profile, avoid = new Set()) {
  const pool = poolFor(profile);
  const out = [];
  for (const m of meals) {
    if (!m.share) continue;
    const t = mealTarget(targets, m.id, meals);
    const meal = generateMeal(m.id, t, pool, avoid);
    meal.items.forEach((i) => i.food.ref && avoid.add(i.food.ref));
    out.push(meal);
  }
  return out;
}

export function planTotals(plan) {
  return sum((plan?.meals || []).flatMap((m) => m.items.map((i) => macrosFor(i.food, i.grams))));
}

export function shoppingList(plans) {
  const map = new Map();
  for (const p of plans) {
    for (const m of p.data?.meals || []) {
      for (const it of m.items) {
        const k = it.food.name;
        map.set(k, (map.get(k) || 0) + it.grams);
      }
    }
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, grams]) => ({ name, grams: r0(grams) }));
}

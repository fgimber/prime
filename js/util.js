import { useContext, AppCtx } from './lib.js';

export const useApp = () => useContext(AppCtx);

export const r0 = (n) => Math.round(+n || 0);
export const r1 = (n) => Math.round((+n || 0) * 10) / 10;
export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function isoDate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}
export function dateLabel(s) {
  const t = isoDate();
  if (s === t) return 'Hoy';
  if (s === addDays(t, -1)) return 'Ayer';
  if (s === addDays(t, 1)) return 'Mañana';
  return parseISO(s).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
}
export const shortDate = (s) => parseISO(s).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

export const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function macrosFor(food, grams) {
  const f = (+grams || 0) / 100;
  return {
    kcal: (+food.kcal || 0) * f,
    protein: (+food.protein || 0) * f,
    carbs: (+food.carbs || 0) * f,
    fat: (+food.fat || 0) * f,
    fiber: (+food.fiber || 0) * f,
  };
}

export function sum(list) {
  return list.reduce(
    (a, x) => ({
      kcal: a.kcal + (+x.kcal || 0),
      protein: a.protein + (+x.protein || 0),
      carbs: a.carbs + (+x.carbs || 0),
      fat: a.fat + (+x.fat || 0),
      fiber: a.fiber + (+x.fiber || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );
}

// Copia mínima de un alimento (valores por 100 g) que se guarda junto a cada registro.
export const snapshot = (f) => ({
  name: f.name,
  brand: f.brand || null,
  barcode: f.barcode || null,
  kcal: r1(f.kcal),
  protein: r1(f.protein),
  carbs: r1(f.carbs),
  fat: r1(f.fat),
  fiber: r1(f.fiber),
  serving_g: f.serving_g ? +f.serving_g : null,
  serving_label: f.serving_label || null,
  unit: !!f.unit,
  source: f.source || 'custom',
  ref: f.id || f.key || null,
});

export function diaryRow(food, grams, meal, date) {
  const m = macrosFor(food, grams);
  return {
    date,
    meal,
    name: food.brand ? `${food.name} · ${food.brand}` : food.name,
    grams: r1(grams),
    kcal: r1(m.kcal),
    protein: r1(m.protein),
    carbs: r1(m.carbs),
    fat: r1(m.fat),
    fiber: r1(m.fiber),
    food: snapshot(food),
  };
}

// Reconstruye el alimento (por 100 g) a partir de un registro del diario.
export function foodFromEntry(e) {
  if (e.food && e.food.kcal != null) return { ...e.food };
  const k = e.grams ? 100 / e.grams : 0;
  return {
    name: e.name, kcal: e.kcal * k, protein: e.protein * k, carbs: e.carbs * k,
    fat: e.fat * k, fiber: (e.fiber || 0) * k, source: 'custom',
  };
}

export function portionLabel(food, grams) {
  if (food.serving_g && food.serving_label) {
    const n = grams / food.serving_g;
    const label = food.serving_label;
    if (Math.abs(n - Math.round(n)) < 0.01 && n >= 1) {
      const k = Math.round(n);
      const g = k === 1 && /\(/.test(label) ? '' : ` (${r0(grams)} g)`;
      if (/^[\d½¼¾]/.test(label)) return k === 1 ? `${label}${g}` : `${k} × ${label}${g}`;
      return `${k} ${label}${k > 1 && !/s$/.test(label) ? 's' : ''}${g}`;
    }
  }
  return `${r0(grams)} g`;
}

export function guessMeal() {
  const h = new Date().getHours();
  if (h < 11) return 'desayuno';
  if (h < 16) return 'almuerzo';
  if (h < 20) return 'merienda';
  return 'cena';
}

export const SOURCE_LABEL = {
  base: 'Base AR', off: 'Open Food Facts', usda: 'USDA', custom: 'Mis alimentos',
  recipe: 'Receta', ai: 'IA', plan: 'Plan',
};

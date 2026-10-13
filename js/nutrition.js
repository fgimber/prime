import { r0, num, isoDate, daysBetween } from './util.js';

export const ACTIVITY = [
  { id: 'sed', label: 'Sedentario (oficina, casi sin entrenar)', f: 1.2 },
  { id: 'light', label: 'Ligero (1–3 entrenamientos/semana)', f: 1.375 },
  { id: 'mod', label: 'Moderado (3–5 entrenamientos/semana)', f: 1.55 },
  { id: 'high', label: 'Alto (6–7 entrenamientos/semana)', f: 1.725 },
  { id: 'athlete', label: 'Muy alto (doble turno o trabajo físico)', f: 1.9 },
];

export const GOALS = [
  { id: 'cut_fast', label: 'Definición agresiva (−0,75 kg/sem)', kgWeek: -0.75 },
  { id: 'cut', label: 'Definición (−0,5 kg/sem)', kgWeek: -0.5 },
  { id: 'cut_slow', label: 'Definición suave (−0,25 kg/sem)', kgWeek: -0.25 },
  { id: 'recomp', label: 'Recomposición (−10% calorías)', pct: -0.1 },
  { id: 'maintain', label: 'Mantenimiento', kgWeek: 0 },
  { id: 'lean_bulk', label: 'Volumen limpio (+0,25 kg/sem)', kgWeek: 0.25 },
  { id: 'bulk', label: 'Volumen (+0,5 kg/sem)', kgWeek: 0.5 },
];

export const MEALS = [
  { id: 'desayuno', label: 'Desayuno', icon: '☕', share: 25 },
  { id: 'almuerzo', label: 'Almuerzo', icon: '🍛', share: 35 },
  { id: 'merienda', label: 'Merienda', icon: '🧉', share: 15 },
  { id: 'cena', label: 'Cena', icon: '🌙', share: 25 },
  { id: 'snacks', label: 'Snacks', icon: '🍎', share: 0 },
];

export function mealsFor(profile) {
  const s = profile?.mealShares || {};
  return MEALS.map((m) => ({ ...m, share: s[m.id] != null && s[m.id] !== '' ? num(s[m.id]) : m.share }));
}

export function mealTarget(targets, mealId, meals) {
  if (!targets) return null;
  const total = meals.reduce((a, m) => a + m.share, 0) || 1;
  const m = meals.find((x) => x.id === mealId);
  const f = (m?.share || 0) / total;
  return { kcal: targets.kcal * f, protein: targets.protein * f, carbs: targets.carbs * f, fat: targets.fat * f };
}

export function ageFrom(birth) {
  if (!birth) return null;
  const d = new Date(birth);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

export const defaultProteinPerKg = (goalId) =>
  goalId?.startsWith('cut') || goalId === 'recomp' ? 2.2 : 1.8;

export function computeTargets(p) {
  if (!p) return null;
  const w = num(p.weight), h = num(p.height), a = ageFrom(p.birthdate) || num(p.age);
  if (!w || !h || !a) return null;
  const female = p.sex === 'f';
  const bf = num(p.bodyfat);

  const mifflin = 10 * w + 6.25 * h - 5 * a + (female ? -161 : 5);
  let bmr = mifflin, method = 'Mifflin-St Jeor';
  if (bf > 0 && bf < 60) {
    const katch = 370 + 21.6 * w * (1 - bf / 100);
    bmr = (mifflin + katch) / 2;
    method = 'Promedio Mifflin-St Jeor + Katch-McArdle';
  }
  const act = ACTIVITY.find((x) => x.id === p.activity) || ACTIVITY[2];
  const tdee = bmr * act.f;
  const goal = GOALS.find((x) => x.id === p.goal) || GOALS.find((x) => x.id === 'maintain');
  const delta = goal.pct != null ? tdee * goal.pct : (goal.kgWeek * 7700) / 7;

  const warnings = [];
  let kcal = tdee + delta;
  const floor = female ? 1200 : 1500;
  if (kcal < floor) {
    warnings.push(`El objetivo quedaba por debajo de ${floor} kcal; lo subí al mínimo recomendado.`);
    kcal = floor;
  }

  // Si estás por encima de tu peso prime, la proteína se calcula sobre ese peso (evita exagerar).
  const primeW = num(p.primeWeight);
  const refW = primeW && primeW < w ? primeW : w;
  const ppk = num(p.proteinPerKg) || defaultProteinPerKg(goal.id);
  const fpk = num(p.fatPerKg) || 0.8;
  let protein = refW * ppk;
  let fat = Math.max(refW * fpk, (kcal * 0.2) / 9);
  let carbs = (kcal - protein * 4 - fat * 9) / 4;
  if (carbs < 50) warnings.push('Quedan pocos carbohidratos: revisá proteína/grasa por kg.');
  carbs = Math.max(0, carbs);

  if (p.useManual) {
    kcal = num(p.manual?.kcal) || kcal;
    protein = num(p.manual?.protein) || protein;
    fat = num(p.manual?.fat) || fat;
    carbs = num(p.manual?.carbs) || Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  }

  // Vuelta al prime
  let prime = null;
  if (primeW) {
    const diff = w - primeW;
    const rate = goal.kgWeek ?? null;
    let weeks = null;
    if (rate && Math.sign(rate) === -Math.sign(diff) && Math.abs(diff) > 0.1) weeks = Math.abs(diff / rate);
    let required = null;
    if (p.primeDate) {
      const d = daysBetween(isoDate(), p.primeDate);
      if (d > 0) required = -(diff / (d / 7));
    }
    const eta = weeks != null ? new Date(Date.now() + weeks * 7 * 86400000) : null;
    prime = { weight: primeW, diff, weeks, eta, requiredKgWeek: required };
    if (required != null && Math.abs(required) > 1) warnings.push(`Para llegar a tu prime en la fecha elegida necesitarías ${required.toFixed(2)} kg/sem: es demasiado rápido.`);
  }

  return {
    bmr: r0(bmr), tdee: r0(tdee), kcal: r0(kcal), protein: r0(protein), carbs: r0(carbs), fat: r0(fat),
    fiber: r0((kcal / 1000) * 14), water: Math.round((w * 35) / 250) * 250,
    method, activity: act, goal, delta: r0(delta), refW, ppk, warnings, prime,
  };
}

// TDEE real estimado con tus datos (peso + calorías registradas).
export function adaptiveTdee(weights, dailyKcal) {
  const ws = weights.filter((w) => w.kg).sort((a, b) => (a.date > b.date ? 1 : -1));
  const days = Object.values(dailyKcal).filter((k) => k > 300);
  if (ws.length < 3 || days.length < 10) return null;
  const span = daysBetween(ws[0].date, ws[ws.length - 1].date);
  if (span < 14) return null;
  // regresión lineal kg vs día
  const xs = ws.map((w) => daysBetween(ws[0].date, w.date));
  const ys = ws.map((w) => +w.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let nu = 0, de = 0;
  xs.forEach((x, i) => { nu += (x - mx) * (ys[i] - my); de += (x - mx) ** 2; });
  const slope = de ? nu / de : 0; // kg por día
  const avg = days.reduce((a, b) => a + b, 0) / days.length;
  return { tdee: r0(avg - slope * 7700), avgIntake: r0(avg), kgPerWeek: slope * 7, days: days.length };
}

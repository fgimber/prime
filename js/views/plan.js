import { html, useState, useEffect } from '../lib.js';
import { db } from '../store.js';
import { useApp, r0, sum, macrosFor, isoDate, addDays, dateLabel, diaryRow, snapshot, portionLabel, parseISO } from '../util.js';
import { mealTarget } from '../nutrition.js';
import { generateDay, generateMeal, poolFor, planTotals, shoppingList } from '../planner.js';
import { aiMealPlan, itemToFood, hasAI } from '../ai.js';
import { Icon, MacroPills, Empty, Spinner } from '../components.js';

export function PlanView({ embedded }) {
  const app = useApp();
  const { targets, meals, profile } = app;
  const [date, setDate] = useState(isoDate());
  const [plan, setPlan] = useState(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlan(undefined);
    db.list('plans', { eq: { date } }).then((r) => setPlan(r[0] || null)).catch((e) => app.toast(e.message, 'error'));
  }, [date, app.version]);

  if (!targets) return html`<div class="view"><div class="card note">Completá tu perfil para generar planes.</div></div>`;

  const save = async (data) => {
    const saved = await db.upsert('plans', { date, data }, 'user_id,date');
    setPlan(saved);
    return saved;
  };

  const generate = async () => {
    setBusy(true);
    try { await save({ source: 'auto', meals: generateDay(targets, meals, profile) }); } catch (e) { app.toast(e.message, 'error'); }
    setBusy(false);
  };

  const generateAI = async () => {
    setBusy(true);
    try {
      const mt = meals.filter((m) => m.share > 0).map((m) => ({ id: m.id, ...mealTarget(targets, m.id, meals) }));
      const out = await aiMealPlan(profile, mt);
      await save({
        source: 'ai',
        meals: out.map((m) => ({ meal: m.meal, title: m.title, items: m.items.map((it) => ({ food: snapshot(itemToFood(it, 'plan')), grams: it.grams })) })),
      });
    } catch (e) { app.toast(e.message, 'error'); }
    setBusy(false);
  };

  const regenMeal = async (mealId) => {
    const current = plan.data.meals.find((m) => m.meal === mealId);
    const avoid = new Set(current.items.map((i) => i.food.ref).filter(Boolean));
    const fresh = generateMeal(mealId, mealTarget(targets, mealId, meals), poolFor(profile), avoid);
    await save({ ...plan.data, meals: plan.data.meals.map((m) => (m.meal === mealId ? fresh : m)) });
  };

  const removeItem = async (mealId, idx) => {
    await save({ ...plan.data, meals: plan.data.meals.map((m) => (m.meal === mealId ? { ...m, items: m.items.filter((_, i) => i !== idx) } : m)) });
  };

  const logMeal = async (m) => {
    await db.insertMany('diary', m.items.map((it) => diaryRow(it.food, it.grams, m.meal, date)));
    app.bump(); app.toast(`${label(m.meal)} agregado a tu diario ✓`);
  };

  const logAll = async () => {
    const rows = plan.data.meals.flatMap((m) => m.items.map((it) => diaryRow(it.food, it.grams, m.meal, date)));
    await db.insertMany('diary', rows);
    app.bump(); app.toast('Plan completo agregado al diario ✓');
  };

  const label = (id) => meals.find((x) => x.id === id)?.label || id;

  const generateWeek = async () => {
    if (!confirm('Se generan planes para los próximos 7 días a partir de esta fecha (reemplaza los existentes). ¿Seguimos?')) return;
    setBusy(true);
    try {
      const avoid = new Set();
      for (let i = 0; i < 7; i++) {
        const d = addDays(date, i);
        if (avoid.size > 30) avoid.clear();
        await db.upsert('plans', { date: d, data: { source: 'auto', meals: generateDay(targets, meals, profile, avoid) } }, 'user_id,date');
      }
      app.bump(); app.toast('Semana generada ✓');
    } catch (e) { app.toast(e.message, 'error'); }
    setBusy(false);
  };

  const openShopping = async () => {
    const plans = await db.list('plans', { gte: { date }, lte: { date: addDays(date, 6) } });
    app.openSheet(html`<${Shopping} plans=${plans} from=${date} />`, 'Lista de compras');
  };

  const totals = plan ? planTotals(plan.data) : null;

  return html`
    <div class="view">
      ${!embedded && html`<h1 class="view-title">Plan de comidas</h1>`}
      <div class="date-bar">
        <button class="icon-btn" onClick=${() => setDate(addDays(date, -1))} aria-label="Día anterior"><${Icon} name="left" /></button>
        <label class="date-label"><b>${dateLabel(date)}</b><input type="date" value=${date} onChange=${(e) => e.target.value && setDate(e.target.value)} /></label>
        <button class="icon-btn" onClick=${() => setDate(addDays(date, 1))} aria-label="Día siguiente"><${Icon} name="right" /></button>
      </div>

      <div class="grid2">
        <button class="btn primary" disabled=${busy} onClick=${generate}><${Icon} name="refresh" size=${18} /> ${plan ? 'Regenerar' : 'Generar plan'}</button>
        <button class="btn ghost" disabled=${busy || !hasAI(profile)} onClick=${generateAI} title=${hasAI(profile) ? '' : 'Configurá la IA en Perfil'}><${Icon} name="sparkles" size=${18} /> Plan con IA</button>
      </div>
      <div class="grid2">
        <button class="btn ghost small" disabled=${busy} onClick=${generateWeek}><${Icon} name="calendar" size=${16} /> Generar 7 días</button>
        <button class="btn ghost small" onClick=${openShopping}><${Icon} name="cart" size=${16} /> Lista de compras</button>
      </div>

      ${busy && html`<${Spinner} label="Armando tu plan…" />`}
      ${plan === undefined && !busy && html`<${Spinner} />`}
      ${plan === null && !busy && html`<${Empty}>Generá un plan que encaje con tus macros (${targets.kcal} kcal · P ${targets.protein} · C ${targets.carbs} · G ${targets.fat}). Podés excluir alimentos en Perfil.<//>`}

      ${plan && !busy && html`
        <section class="card">
          <div class="total-line"><span>Total del plan</span><b>${r0(totals.kcal)} / ${targets.kcal} kcal</b><${MacroPills} m=${totals} /></div>
          <div class="muted small">${plan.data.source === 'ai' ? 'Generado con IA' : 'Generado automáticamente'} · objetivo P ${targets.protein} · C ${targets.carbs} · G ${targets.fat}</div>
        </section>
        ${plan.data.meals.map((m) => {
          const t = sum(m.items.map((i) => macrosFor(i.food, i.grams)));
          return html`<section class="card meal">
            <header class="meal-head">
              <div><h3>${meals.find((x) => x.id === m.meal)?.icon || ''} ${label(m.meal)}</h3>
                ${m.title && html`<div class="small">${m.title}</div>`}
                <span class="muted small">${r0(t.kcal)} kcal · P ${r0(t.protein)} · C ${r0(t.carbs)} · G ${r0(t.fat)}</span></div>
              <div class="row-actions">
                ${plan.data.source !== 'ai' && html`<button class="icon-btn" onClick=${() => regenMeal(m.meal)} aria-label="Cambiar comida"><${Icon} name="refresh" size=${18} /></button>`}
                <button class="icon-btn add" onClick=${() => logMeal(m)} aria-label="Registrar en diario"><${Icon} name="check" size=${18} /></button>
              </div>
            </header>
            <div class="list flush">${m.items.map((it, i) => html`<div class="row">
              <div class="row-main"><div class="row-title">${it.food.name}</div><div class="row-sub muted">${portionLabel(it.food, it.grams)}</div></div>
              <div class="row-side"><strong>${r0(macrosFor(it.food, it.grams).kcal)}</strong><small class="muted">kcal</small></div>
              <button class="icon-btn" onClick=${() => removeItem(m.meal, i)} aria-label="Quitar"><${Icon} name="x" size=${16} /></button>
            </div>`)}</div>
          </section>`;
        })}
        <button class="btn" onClick=${logAll}><${Icon} name="check" size=${18} /> Registrar todo el día en el diario</button>
      `}
    </div>`;
}

function Shopping({ plans, from }) {
  const app = useApp();
  const list = shoppingList(plans);
  const [checked, setChecked] = useState({});
  const fmt = (g) => (g >= 1000 ? `${(g / 1000).toFixed(1).replace('.', ',')} kg` : `${g} g`);
  const copy = async () => {
    const txt = list.map((i) => `• ${i.name}: ${fmt(i.grams)}`).join('\n');
    try { await navigator.clipboard.writeText(txt); app.toast('Lista copiada ✓'); } catch { app.toast('No se pudo copiar', 'error'); }
  };
  if (!plans.length) return html`<${Empty}>No hay planes entre ${dateLabel(from)} y ${dateLabel(addDays(from, 6))}. Usá "Generar 7 días".<//>`;
  return html`<div class="stack">
    <p class="muted small">${plans.length} día(s) planificados desde ${parseISO(from).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })}. Cantidades en peso listo para comer (la carne cruda pesa ~25% más; el arroz/fideos secos ~⅓ del cocido).</p>
    <div class="list">${list.map((i) => html`<label class=${'row check-row' + (checked[i.name] ? ' done' : '')}>
      <input type="checkbox" checked=${!!checked[i.name]} onChange=${() => setChecked({ ...checked, [i.name]: !checked[i.name] })} />
      <div class="row-main"><div class="row-title">${i.name}</div></div><b>${fmt(i.grams)}</b>
    </label>`)}</div>
    <button class="btn primary" onClick=${copy}><${Icon} name="copy" size=${18} /> Copiar lista</button>
  </div>`;
}

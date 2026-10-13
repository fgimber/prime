import { html, useState, useEffect } from '../lib.js';
import { db } from '../store.js';
import { useApp, r0, sum, isoDate, addDays, dateLabel, foodFromEntry, portionLabel } from '../util.js';
import { mealTarget } from '../nutrition.js';
import { Icon, Ring, MacroBar, Empty } from '../components.js';
import { AddFood, FoodDetail } from './add-food.js';
import { CoachCard } from './coach.js';
import { dayType, typeName, foodItems, KEY_OF_MEAL } from '../gym-data.js';

export function TodayView() {
  const app = useApp();
  const { targets, meals } = app;
  const [date, setDate] = useState(isoDate());
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    let alive = true;
    db.list('diary', { eq: { date }, order: 'created_at', asc: true })
      .then((e) => { if (alive) setEntries(e); })
      .catch((err) => app.toast(err.message, 'error'));
    return () => { alive = false; };
  }, [date, app.version]);

  const { H } = app;
  const hasRotation = !!H.settings.firstGuardia;
  const dt = dayType(date, H);
  const planFood = Object.fromEntries(foodItems(date, H).map((i) => [i.k, i]));
  const dayData = H.days[date] || { c: {} };
  const total = sum(entries || []);
  const water = dayData.water_ml || 0;
  const addWater = (ml) => app.setWater(date, water + ml);
  const toggleMeal = (key) => app.updateDay(date, (x) => { x.c[key] = !x.c[key]; return x; });

  const openAdd = (meal) => app.openSheet(html`<${AddFood} date=${date} meal=${meal} />`, `Agregar · ${meals.find((m) => m.id === meal)?.label}`);
  const openEntry = (e) => {
    const food = foodFromEntry(e);
    app.openSheet(html`<${FoodDetail} food=${food} grams=${e.grams} meal=${e.meal} date=${date} entry=${e} />`, e.name);
  };
  const copyYesterday = async (meal) => {
    const prev = await db.list('diary', { eq: { date: addDays(date, -1), meal } });
    if (!prev.length) return app.toast('Ayer no registraste nada en esa comida');
    await db.insertMany('diary', prev.map(({ id, user_id, created_at, ...r }) => ({ ...r, date })));
    app.bump(); app.toast(`Copiados ${prev.length} alimentos ✓`);
  };

  const visibleMeals = meals.filter((m) => m.share > 0 || (entries || []).some((e) => e.meal === m.id) || m.id === 'snacks');

  return html`
    <div class="view">
      <div class="date-bar">
        <button class="icon-btn" onClick=${() => setDate(addDays(date, -1))} aria-label="Día anterior"><${Icon} name="left" /></button>
        <label class="date-label">
          <b class="d bigdate">${dateLabel(date)}</b>
          ${hasRotation && html`<div class="small"><span class=${'tag' + (dt === 'G' ? ' g' : '')}>${typeName[dt]}</span></div>`}
          <input type="date" value=${date} onChange=${(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button class="icon-btn" onClick=${() => setDate(addDays(date, 1))} aria-label="Día siguiente"><${Icon} name="right" /></button>
      </div>

      ${targets ? html`
        <section class="card summary">
          <div class="summary-top">
            <div class="stat"><b>${r0(targets.kcal)}</b><span>Objetivo</span></div>
            <${Ring} value=${total.kcal} target=${targets.kcal} />
            <div class="stat"><b>${r0(total.kcal)}</b><span>Consumidas</span></div>
          </div>
          <div class="macros">
            <${MacroBar} label="Proteína" value=${total.protein} target=${targets.protein} color="var(--p)" />
            <${MacroBar} label="Carbohidratos" value=${total.carbs} target=${targets.carbs} color="var(--c)" />
            <${MacroBar} label="Grasas" value=${total.fat} target=${targets.fat} color="var(--f)" />
          </div>
          <div class="muted small center">Fibra ${r0(total.fiber)} / ${targets.fiber} g</div>
        </section>` : html`<div class="card note">Completá tu perfil para calcular tus objetivos.</div>`}
      <${CoachCard} />

      ${visibleMeals.map((m) => {
        const list = (entries || []).filter((e) => e.meal === m.id);
        const t = sum(list);
        const mt = mealTarget(targets, m.id, meals);
        const pk = KEY_OF_MEAL[m.id];
        const pf = hasRotation && pk && planFood[pk];
        return html`
          <section class="card meal">
            <header class="meal-head">
              <div><h3>${m.icon} ${m.label}</h3>
                <span class="muted small">${r0(t.kcal)}${mt && mt.kcal ? ` / ${r0(mt.kcal)}` : ''} kcal · P ${r0(t.protein)} · C ${r0(t.carbs)} · G ${r0(t.fat)}</span></div>
              <button class="icon-btn add" onClick=${() => openAdd(m.id)} aria-label=${'Agregar a ' + m.label}><${Icon} name="plus" /></button>
            </header>
            ${pf && html`<button class=${'plan-hint' + (dayData.c[pk] ? ' on' : '')} onClick=${() => toggleMeal(pk)} aria-pressed=${!!dayData.c[pk]}>
              <span class="box"><${Icon} name="check" size=${14} /></span>
              <span><b>${pf.t.includes('·') ? pf.t.split('· ')[1] : 'Toca'}:</b> ${pf.s}</span>
            </button>`}
            ${list.length > 0 && html`<div class="list flush">
              ${list.map((e) => html`
                <div class="row" onClick=${() => openEntry(e)} role="button" tabindex="0">
                  <div class="row-main"><div class="row-title">${e.name}</div><div class="row-sub muted">${portionLabel(e.food || {}, e.grams)}</div></div>
                  <div class="row-side"><strong>${r0(e.kcal)}</strong><small class="muted">kcal</small></div>
                </div>`)}
            </div>`}
            ${entries && !list.length && html`<button class="link-btn" onClick=${() => copyYesterday(m.id)}><${Icon} name="copy" size=${14} /> Copiar de ayer</button>`}
          </section>`;
      })}

      ${targets && html`
        <section class="card water">
          <div class="water-head"><h3><${Icon} name="droplet" size=${18} /> Agua</h3><span class="muted small">${(water / 1000).toFixed(2).replace('.', ',')} / ${(targets.water / 1000).toFixed(1).replace('.', ',')} L</span></div>
          <div class="glasses">${Array.from({ length: Math.ceil(targets.water / 250) }, (_, i) => html`<span class=${'glass' + (i < water / 250 ? ' on' : '')}></span>`)}</div>
          <div class="grid2"><button class="btn ghost small" onClick=${() => addWater(-250)}>− 250 ml</button><button class="btn small" onClick=${() => addWater(250)}>+ 250 ml</button></div>
        </section>`}

      ${entries && !entries.length && html`<${Empty}>Tocá + en una comida, o el botón verde, para registrar lo que comés.<//>`}
      <button class="fab" onClick=${() => openAdd(guess(meals))} aria-label="Agregar comida"><${Icon} name="plus" size=${26} /></button>
    </div>`;
}

function guess(meals) {
  const h = new Date().getHours();
  const id = h < 11 ? 'desayuno' : h < 16 ? 'almuerzo' : h < 20 ? 'merienda' : 'cena';
  return meals.find((m) => m.id === id) ? id : meals[0].id;
}

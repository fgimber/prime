import { html, useState, useEffect, useRef } from '../lib.js';
import { db } from '../store.js';
import { useApp, r0, sum, isoDate, addDays, dateLabel, foodFromEntry, portionLabel } from '../util.js';
import { mealTarget } from '../nutrition.js';
import { Icon, Ring, MacroBar, Empty, useCountUp } from '../components.js';
import { AddFood, FoodDetail } from './add-food.js';
import { AiPanel } from './ai-log.js';
import { fileToBase64 } from '../ai.js';
import { CoachCard } from './coach.js';
import { dayLabel, isGymDay, hasPlan } from '../gym-data.js';

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
  const hasRotation = hasPlan(H);
  const dayData = H.days[date] || { c: {} };
  const total = sum(entries || []);
  const water = dayData.water_ml || 0;
  const [splash, setSplash] = useState(0);
  const addWater = (ml) => { app.setWater(date, water + ml); if (ml > 0) { setSplash(Date.now()); navigator.vibrate?.(10); } };
  useEffect(() => { if (!splash) return; const t = setTimeout(() => setSplash(0), 700); return () => clearTimeout(t); }, [splash]);

  // Foto de la comida → la IA la analiza sola (qué es y cuántos gramos).
  const camRef = useRef();
  const scanPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const ph = await fileToBase64(file, 1280);
      const meal = guess(meals);
      app.openSheet(html`<${AiPanel} date=${date} meal=${meal} initialPhoto=${ph} auto />`, `Escanear comida · ${meals.find((m) => m.id === meal)?.label}`);
    } catch (err) { app.toast(err.message, 'error'); }
  };
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
          ${hasRotation && html`<div class="small"><span class=${'tag' + (isGymDay(date, H) ? ' g' : '')}>${dayLabel(date, H)}</span></div>`}
          <input type="date" value=${date} onChange=${(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button class="icon-btn" onClick=${() => setDate(addDays(date, 1))} aria-label="Día siguiente"><${Icon} name="right" /></button>
      </div>

      ${targets ? html`
        <section class="card summary hero-sum">
          <span class="eyebrow">Resumen del día</span>
          <div class="summary-top">
            <div class="stat"><b>${r0(targets.kcal)}</b><span>Objetivo</span></div>
            <${Ring} value=${total.kcal} target=${targets.kcal} />
            <${CountStat} value=${r0(total.kcal)} label="Consumidas" />
          </div>
          <div class="macros">
            <${MacroBar} label="Proteína" value=${total.protein} target=${targets.protein} color="var(--p)" />
            <${MacroBar} label="Carbos" value=${total.carbs} target=${targets.carbs} color="var(--c)" />
            <${MacroBar} label="Grasas" value=${total.fat} target=${targets.fat} color="var(--f)" />
          </div>
          <div class="muted small center">Fibra ${r0(total.fiber)} / ${targets.fiber} g</div>
        </section>` : html`<div class="card note">Completá tu perfil para calcular tus objetivos.</div>`}
      <${CoachCard} />

      ${visibleMeals.map((m) => {
        const list = (entries || []).filter((e) => e.meal === m.id);
        const t = sum(list);
        const mt = mealTarget(targets, m.id, meals);
        return html`
          <section class="card meal">
            <header class="meal-head">
              <div><h3>${m.icon} ${m.label}</h3>
                <span class="muted small">${r0(t.kcal)}${mt && mt.kcal ? ` / ${r0(mt.kcal)}` : ''} kcal · P ${r0(t.protein)} · C ${r0(t.carbs)} · G ${r0(t.fat)}</span></div>
              <button class="icon-btn add" onClick=${() => openAdd(m.id)} aria-label=${'Agregar a ' + m.label}><${Icon} name="plus" /></button>
            </header>

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
          <div class="water-bar"><div style=${{ width: Math.min(100, (water / targets.water) * 100) + '%' }}></div></div>
          <div class="glasses">${Array.from({ length: Math.ceil(targets.water / 250) }, (_, i) => html`<span class=${'glass' + (i < water / 250 ? ' on' : '') + (i === Math.ceil(water / 250) - 1 && splash ? ' splash' : '')} style=${{ '--i': i }}></span>`)}</div>
          ${water >= targets.water && html`<p class="small water-done">💧 ¡Objetivo de agua cumplido!</p>`}
          <div class="grid2"><button class="btn ghost small" onClick=${() => addWater(-250)}>− 250 ml</button><button class="btn small" onClick=${() => addWater(250)}>+ 250 ml</button></div>
        </section>`}

      ${entries && !entries.length && html`<${Empty}>Tocá + en una comida, o el botón verde, para registrar lo que comés.<//>`}
      <input ref=${camRef} type="file" accept="image/*" capture="environment" hidden onChange=${scanPhoto} />
      <button class="fab cam" onClick=${() => camRef.current.click()} aria-label="Sacar foto de la comida"><${Icon} name="camera" size=${22} /></button>
      <button class="fab" onClick=${() => openAdd(guess(meals))} aria-label="Agregar comida"><${Icon} name="plus" size=${26} /></button>
    </div>`;
}

function guess(meals) {
  const h = new Date().getHours();
  const id = h < 11 ? 'desayuno' : h < 16 ? 'almuerzo' : h < 20 ? 'merienda' : 'cena';
  return meals.find((m) => m.id === id) ? id : meals[0].id;
}

function CountStat({ value, label }) {
  const v = useCountUp(value);
  return html`<div class="stat"><b>${Math.round(v)}</b><span>${label}</span></div>`;
}

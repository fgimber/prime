import { html, useState, useEffect } from '../lib.js';
import { db } from '../store.js';
import { useApp, r0, r1, num, sum, macrosFor, snapshot, diaryRow, isoDate } from '../util.js';
import { MEALS } from '../nutrition.js';
import { parseRecipe, itemToFood, hasAI } from '../ai.js';
import { Icon, Field, Segmented, MacroPills, Empty, Spinner } from '../components.js';
import { AddFood, CreateFoodForm } from './add-food.js';
import { AiItems, NoAiKey } from './ai-log.js';

export function recipeTotals(r) {
  const items = r.items || [];
  const t = sum(items.map((i) => macrosFor(i.food, i.grams)));
  const rawG = items.reduce((a, i) => a + (+i.grams || 0), 0);
  const totalG = +r.total_g || rawG;
  const servings = +r.servings || 1;
  return { ...t, totalG, servings, perServing: { kcal: t.kcal / servings, protein: t.protein / servings, carbs: t.carbs / servings, fat: t.fat / servings, fiber: t.fiber / servings } };
}

// Una receta se comporta como un alimento: valores por 100 g + porción.
export function recipeToFood(r) {
  const t = recipeTotals(r);
  const k = t.totalG ? 100 / t.totalG : 0;
  return {
    id: r.id, key: 'recipe:' + r.id, name: r.name,
    kcal: t.kcal * k, protein: t.protein * k, carbs: t.carbs * k, fat: t.fat * k, fiber: t.fiber * k,
    serving_g: t.totalG / t.servings, serving_label: 'porción', unit: true, source: 'recipe',
  };
}

export function RecipesView({ embedded }) {
  const app = useApp();
  const [seg, setSeg] = useState('recetas');
  const [recipes, setRecipes] = useState(null);
  const [foods, setFoods] = useState(null);

  useEffect(() => {
    db.list('recipes', { order: 'created_at' }).then(setRecipes).catch((e) => app.toast(e.message, 'error'));
    db.list('foods', { order: 'name', asc: true }).then(setFoods).catch(() => {});
  }, [app.version]);

  const edit = (r) => app.openSheet(html`<${RecipeEditor} recipe=${r} />`, r ? r.name : 'Nueva receta');
  const importAi = () => app.openSheet(html`<${RecipeImport} />`, 'Importar receta con IA');
  const editFood = (f) => app.openSheet(html`<${FoodEditor} food=${f} />`, f ? f.name : 'Nuevo alimento');

  return html`
    <div class="view">
      ${!embedded && html`<h1 class="view-title">Recetas</h1>`}
      <${Segmented} value=${seg} onChange=${setSeg} options=${[{ id: 'recetas', label: 'Mis recetas', icon: 'book' }, { id: 'alimentos', label: 'Mis alimentos', icon: 'star' }]} />
      ${seg === 'recetas' && html`
        <div class="grid2">
          <button class="btn primary" onClick=${() => edit(null)}><${Icon} name="plus" size=${18} /> Nueva receta</button>
          <button class="btn ghost" onClick=${importAi}><${Icon} name="sparkles" size=${18} /> Importar con IA</button>
        </div>
        ${recipes === null ? html`<${Spinner} />` : recipes.length === 0 ? html`<${Empty}>Creá tus recetas (ej: "Pollo al curry con arroz") y la app calcula los macros por porción. Después las registrás en un toque.<//>` : html`
          <div class="list">${recipes.map((r) => {
            const t = recipeTotals(r);
            return html`<div class="row" onClick=${() => edit(r)} role="button" tabindex="0">
              <div class="row-main"><div class="row-title">${r.name}</div><div class="row-sub"><span class="muted">${t.servings} porc. · </span><${MacroPills} m=${t.perServing} compact /></div></div>
              <div class="row-side"><strong>${r0(t.perServing.kcal)}</strong><small class="muted">kcal/porc.</small></div>
            </div>`;
          })}</div>`}
      `}
      ${seg === 'alimentos' && html`
        <button class="btn primary" onClick=${() => editFood(null)}><${Icon} name="plus" size=${18} /> Nuevo alimento</button>
        ${foods === null ? html`<${Spinner} />` : foods.length === 0 ? html`<${Empty}>Acá aparecen los alimentos que cargues o guardes (⭐) desde Open Food Facts, USDA o la IA.<//>` : html`
          <div class="list">${foods.map((f) => html`<div class="row" onClick=${() => editFood(f)} role="button" tabindex="0">
            <div class="row-main"><div class="row-title">${f.name}</div><div class="row-sub muted">${f.brand ? f.brand + ' · ' : ''}por 100 g · P ${r0(f.protein)} C ${r0(f.carbs)} G ${r0(f.fat)}</div></div>
            <div class="row-side"><strong>${r0(f.kcal)}</strong><small class="muted">kcal</small></div>
          </div>`)}</div>`}
      `}
    </div>`;
}

function FoodEditor({ food }) {
  const app = useApp();
  const del = async () => {
    if (!confirm(`¿Eliminar "${food.name}"?`)) return;
    await db.remove('foods', food.id);
    app.bump(); app.closeSheet(); app.toast('Eliminado');
  };
  return html`<div class="stack">
    <${CreateFoodForm} existing=${food} onSaved=${() => app.closeSheet()} />
    ${food && html`<button class="btn danger ghost" onClick=${del}><${Icon} name="trash" size=${16} /> Eliminar alimento</button>`}
  </div>`;
}

export function RecipeEditor({ recipe, preset }) {
  const app = useApp();
  const [name, setName] = useState(recipe?.name || preset?.name || '');
  const [servings, setServings] = useState(String(recipe?.servings || preset?.servings || 1));
  const [totalG, setTotalG] = useState(recipe?.total_g ? String(recipe.total_g) : '');
  const [items, setItems] = useState(recipe?.items || preset?.items || []);
  const [notes, setNotes] = useState(recipe?.notes || '');
  const [busy, setBusy] = useState(false);
  const [logMeal, setLogMeal] = useState('almuerzo');
  const [logServ, setLogServ] = useState('1');

  const draft = { name, servings: num(servings) || 1, total_g: num(totalG) || null, items, notes };
  const t = recipeTotals(draft);

  const addIngredient = () =>
    app.openSheet(html`<${AddFood} mode="pick" onPick=${(food, grams) => setItems((list) => [...list, { food: snapshot(food), grams: r0(grams) }])} />`, 'Agregar ingrediente');
  const setG = (i, v) => setItems(items.map((it, j) => (j === i ? { ...it, grams: v } : it)));

  const save = async (andClose = true) => {
    if (!name.trim()) { app.toast('Poné un nombre a la receta', 'error'); return null; }
    if (!items.length) { app.toast('Agregá al menos un ingrediente', 'error'); return null; }
    setBusy(true);
    const row = { ...draft, name: name.trim(), items: items.map((i) => ({ ...i, grams: num(i.grams) })) };
    try {
      const saved = recipe ? await db.update('recipes', recipe.id, row) : await db.insert('recipes', row);
      app.bump(); app.toast('Receta guardada ✓');
      if (andClose) app.closeSheet();
      return saved;
    } catch (e) { app.toast(e.message, 'error'); return null; } finally { setBusy(false); }
  };

  const log = async () => {
    const saved = await save(false);
    if (!saved) return;
    const food = recipeToFood(saved);
    await db.insert('diary', diaryRow(food, food.serving_g * num(logServ), logMeal, isoDate()));
    app.bump(); app.closeSheet(); app.toast('Receta registrada en Hoy ✓');
  };

  const del = async () => {
    if (!confirm('¿Eliminar esta receta?')) return;
    await db.remove('recipes', recipe.id);
    app.bump(); app.closeSheet(); app.toast('Receta eliminada');
  };

  return html`
    <div class="stack">
      <${Field} label="Nombre"><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Ej: Tarta de atún" /><//>
      <div class="grid2">
        <${Field} label="Porciones"><input type="number" inputmode="decimal" min="1" value=${servings} onInput=${(e) => setServings(e.target.value)} /><//>
        <${Field} label="Peso final cocido (g)" hint="Opcional: si la pesás terminada"><input type="number" inputmode="decimal" value=${totalG} onInput=${(e) => setTotalG(e.target.value)} placeholder=${r0(items.reduce((a, i) => a + num(i.grams), 0))} /><//>
      </div>

      <h3 class="section-title">Ingredientes</h3>
      ${items.length === 0 && html`<p class="muted small">Agregá ingredientes desde el buscador, escáner o tus alimentos.</p>`}
      <div class="list">${items.map((it, i) => {
        const m = macrosFor(it.food, num(it.grams));
        return html`<div class="row">
          <div class="row-main"><div class="row-title">${it.food.name}</div><div class="row-sub"><${MacroPills} m=${m} compact /></div></div>
          <div class="grams-in"><input type="number" inputmode="decimal" value=${it.grams} onInput=${(e) => setG(i, e.target.value)} /><small>g</small></div>
          <div class="row-side"><strong>${r0(m.kcal)}</strong><small class="muted">kcal</small></div>
          <button class="icon-btn" onClick=${() => setItems(items.filter((_, j) => j !== i))} aria-label="Quitar"><${Icon} name="x" size=${16} /></button>
        </div>`;
      })}</div>
      <button class="btn ghost" onClick=${addIngredient}><${Icon} name="plus" size=${18} /> Agregar ingrediente</button>

      <div class="card inset">
        <div class="total-line"><span>Total receta</span><b>${r0(t.kcal)} kcal</b><${MacroPills} m=${t} /></div>
        <div class="total-line"><span>Por porción (${r0(t.totalG / t.servings)} g)</span><b>${r0(t.perServing.kcal)} kcal</b><${MacroPills} m=${t.perServing} /></div>
      </div>

      <${Field} label="Notas / preparación"><textarea rows="3" value=${notes} onInput=${(e) => setNotes(e.target.value)}></textarea><//>
      <button class="btn primary" disabled=${busy} onClick=${() => save()}>Guardar receta</button>

      <div class="card inset stack">
        <b>Registrar en Hoy</b>
        <div class="grid2">
          <${Field} label="Porciones"><input type="number" inputmode="decimal" value=${logServ} onInput=${(e) => setLogServ(e.target.value)} /><//>
          <${Field} label="Comida"><select value=${logMeal} onChange=${(e) => setLogMeal(e.target.value)}>${MEALS.map((m) => html`<option value=${m.id}>${m.label}</option>`)}</select><//>
        </div>
        <button class="btn" disabled=${busy} onClick=${log}>Guardar y registrar</button>
      </div>
      ${recipe && html`<button class="btn danger ghost" onClick=${del}><${Icon} name="trash" size=${16} /> Eliminar receta</button>`}
    </div>`;
}

function RecipeImport() {
  const app = useApp();
  const [text, setText] = useState('');
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!hasAI(app.profile)) return html`<${NoAiKey} />`;

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { setItems((await parseRecipe(app.profile, text)).items); } catch (e) { app.toast(e.message, 'error'); }
    setBusy(false);
  };
  const toEditor = () => {
    const first = text.trim().split('\n')[0].slice(0, 60);
    const preset = {
      name: first, servings: 1,
      items: items.filter((i) => !i.off).map((it) => ({ food: snapshot(itemToFood(it)), grams: it.grams })),
    };
    app.closeSheet();
    app.openSheet(html`<${RecipeEditor} preset=${preset} />`, 'Nueva receta');
  };

  return html`<div class="stack">
    <textarea rows="7" placeholder="Pegá la receta (título en la primera línea, después los ingredientes con cantidades)…" value=${text} onInput=${(e) => setText(e.target.value)}></textarea>
    <button class="btn primary" disabled=${busy} onClick=${run}><${Icon} name="sparkles" size=${18} /> Analizar receta</button>
    ${busy && html`<${Spinner} label="Calculando ingredientes…" />`}
    ${items && html`<${AiItems} items=${items} setItems=${setItems} /><button class="btn primary" onClick=${toEditor}>Continuar</button>`}
  </div>`;
}

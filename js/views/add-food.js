import { html, useState, useEffect, useMemo, useRef } from '../lib.js';
import { db } from '../store.js';
import { useApp, r0, r1, num, diaryRow, foodFromEntry, macrosFor, isoDate, addDays, SOURCE_LABEL, norm, portionLabel } from '../util.js';
import { searchLocal, searchOFF, searchUSDA, lookupBarcode } from '../food-api.js';
import { Icon, MacroPills, Field, Segmented, Spinner, Empty } from '../components.js';
import { MEALS } from '../nutrition.js';
import { recipeToFood } from './recipes.js';
import { ScanPanel } from './scanner.js';
import { AiPanel } from './ai-log.js';

const customToFood = (f) => ({ ...f, source: 'custom' });

// Panel principal para agregar alimentos (o elegir un ingrediente en modo "pick").
export function AddFood({ date, meal, mode = 'log', onPick }) {
  const app = useApp();
  const [tab, setTab] = useState('buscar');
  const [barcode, setBarcode] = useState(null);

  const openDetail = (food, grams) =>
    app.openSheet(html`<${FoodDetail} food=${food} grams=${grams} meal=${meal} date=${date} mode=${mode} onPick=${onPick} />`, food.name);

  const tabs = [
    { id: 'buscar', label: 'Buscar', icon: 'search' },
    { id: 'escanear', label: 'Escanear', icon: 'barcode' },
    ...(mode === 'log' ? [{ id: 'ia', label: 'IA', icon: 'sparkles' }] : []),
    { id: 'crear', label: 'Crear', icon: 'plus' },
  ];

  const onCode = async (code) => {
    const mine = await db.list('foods', { eq: { barcode: code } });
    if (mine[0]) return openDetail(customToFood(mine[0]));
    const f = await lookupBarcode(code);
    if (f && !f.partial) return openDetail(f);
    app.toast(f ? 'El producto existe pero no tiene datos nutricionales: cargalos vos.' : 'Producto no encontrado: cargalo una vez y queda guardado.');
    setBarcode({ code, name: f?.name || '', brand: f?.brand || '' });
    setTab('crear');
  };

  return html`
    <div class="stack">
      <${Segmented} value=${tab} options=${tabs} onChange=${setTab} />
      ${tab === 'buscar' && html`<${SearchPanel} mode=${mode} meal=${meal} date=${date} onChoose=${openDetail} />`}
      ${tab === 'escanear' && html`<${ScanPanel} onCode=${onCode} />`}
      ${tab === 'ia' && html`<${AiPanel} date=${date} meal=${meal} />`}
      ${tab === 'crear' && html`<${CreateFoodForm} initial=${barcode && { barcode: barcode.code, name: barcode.name, brand: barcode.brand }}
          onSaved=${(f) => { setBarcode(null); setTab('buscar'); openDetail(customToFood(f)); }} />`}
    </div>`;
}

function SearchPanel({ mode, meal, date, onChoose }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [recent, setRecent] = useState([]);
  const [off, setOff] = useState({ loading: false, items: [], error: null });
  const [usda, setUsda] = useState(null);
  const [retry, setRetry] = useState(0);
  const inputRef = useRef();

  useEffect(() => {
    inputRef.current?.focus();
    db.list('foods', { order: 'created_at' }).then(setCustom).catch(() => {});
    db.list('recipes', { order: 'created_at' }).then(setRecipes).catch(() => {});
    db.list('diary', { gte: { date: addDays(isoDate(), -60) }, order: 'created_at', limit: 400 }).then((rows) => {
      const seen = new Set(), out = [];
      for (const e of rows) {
        const k = norm(e.name);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ food: foodFromEntry(e), grams: e.grams });
        if (out.length >= 30) break;
      }
      setRecent(out);
    }).catch(() => {});
  }, [app.version]);

  const extra = useMemo(() => [
    ...custom.map(customToFood),
    ...recipes.map(recipeToFood),
  ], [custom, recipes]);

  const local = useMemo(() => searchLocal(q, extra), [q, extra]);

  useEffect(() => {
    setUsda(null);
    if (q.trim().length < 3) { setOff({ loading: false, items: [], error: null }); return; }
    const ctl = new AbortController();
    setOff((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(() => {
      searchOFF(q.trim(), ctl.signal)
        .then((items) => setOff({ loading: false, items, error: null }))
        .catch((e) => e.name !== 'AbortError' && setOff({ loading: false, items: [], error: e.message }));
    }, 650);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, retry]);

  const runUsda = () => {
    setUsda({ loading: true, items: [] });
    searchUSDA(q.trim(), app.profile?.usdaKey)
      .then((items) => setUsda({ loading: false, items }))
      .catch((e) => setUsda({ loading: false, items: [], error: e.message }));
  };

  const quickAdd = async (food, grams) => {
    try {
      await db.insert('diary', diaryRow(food, grams, meal, date));
      app.bump();
      app.toast(`${food.name} agregado ✓`);
    } catch (e) { app.toast(e.message, 'error'); }
  };

  const row = (food, grams) => html`<${FoodRow} food=${food} grams=${grams} onClick=${() => onChoose(food, grams)}
    onQuick=${mode === 'log' ? () => quickAdd(food, grams || food.serving_g || 100) : null} />`;

  return html`
    <div class="stack">
      <div class="search-box">
        <${Icon} name="search" />
        <input ref=${inputRef} type="search" placeholder="Buscá: pollo, avena, alfajor, marca…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      </div>
      ${!q && html`
        <h3 class="section-title">Recientes</h3>
        ${recent.length ? html`<div class="list">${recent.map((r) => row(r.food, r.grams))}</div>`
          : html`<${Empty}>Todavía no registraste comidas. Buscá un alimento, escaneá un código o usá la IA.<//>`}
      `}
      ${q && html`
        ${local.length > 0 && html`<h3 class="section-title">Base propia y mis alimentos</h3><div class="list">${local.map((f) => row(f))}</div>`}
        <h3 class="section-title">Open Food Facts ${off.loading && html`<span class="mini-spin"></span>`}</h3>
        ${off.error && html`<p class="muted small">${off.error} <button class="link-btn" onClick=${() => setRetry((n) => n + 1)}>Reintentar</button></p>`}
        ${!off.loading && !off.error && !off.items.length && q.trim().length >= 3 && html`<p class="muted small">Sin resultados de productos.</p>`}
        ${off.items.length > 0 && html`<div class="list">${off.items.map((f) => row(f))}</div>`}
        <h3 class="section-title">USDA (en inglés)</h3>
        ${!usda && html`<button class="btn ghost" onClick=${runUsda}>Buscar "${q}" en USDA</button>`}
        ${usda?.loading && html`<${Spinner} />`}
        ${usda?.error && html`<p class="muted small">${usda.error}</p>`}
        ${usda?.items?.length > 0 && html`<div class="list">${usda.items.map((f) => row(f))}</div>`}
        ${usda && !usda.loading && !usda.error && !usda.items.length && html`<p class="muted small">Sin resultados. Probá en inglés (ej: "chicken breast").</p>`}
      `}
    </div>`;
}

export function FoodRow({ food, grams, onClick, onQuick }) {
  const g = grams || food.serving_g || 100;
  const m = macrosFor(food, g);
  return html`
    <div class="row" onClick=${onClick} role="button" tabindex="0">
      <div class="row-main">
        <div class="row-title">${food.name}</div>
        <div class="row-sub muted">${food.brand ? food.brand + ' · ' : ''}${portionLabel(food, g)} · ${SOURCE_LABEL[food.source] || ''}</div>
      </div>
      <div class="row-side">
        <strong>${r0(m.kcal)}</strong><small class="muted">kcal</small>
      </div>
      ${onQuick && html`<button class="icon-btn add" aria-label="Agregar rápido" onClick=${(e) => { e.stopPropagation(); onQuick(); }}><${Icon} name="plus" /></button>`}
    </div>`;
}

// Detalle de un alimento: elegir porción, comida y agregar / editar.
export function FoodDetail({ food, grams: g0, meal: m0, date, mode = 'log', onPick, entry }) {
  const app = useApp();
  const hasServing = food.serving_g > 0;
  const initial = g0 || food.serving_g || 100;
  const halves = hasServing ? (initial / food.serving_g) * 2 : 0.5;
  const [unit, setUnit] = useState(hasServing && Math.abs(halves - Math.round(halves)) < 0.01 ? 'serving' : 'g');
  const [amount, setAmount] = useState(unit === 'serving' ? String(r1(initial / food.serving_g)) : String(r0(initial)));
  const [meal, setMeal] = useState(m0 || 'almuerzo');
  const [busy, setBusy] = useState(false);
  const grams = unit === 'serving' ? num(amount) * food.serving_g : num(amount);
  const m = macrosFor(food, grams);

  const switchUnit = (u) => {
    if (u === unit) return;
    setAmount(u === 'serving' ? String(r1(grams / food.serving_g)) : String(r0(grams)));
    setUnit(u);
  };

  const submit = async () => {
    if (!(grams > 0)) return app.toast('Ingresá una cantidad', 'error');
    setBusy(true);
    try {
      if (mode === 'pick') {
        onPick(food, grams);
        app.closeSheet(2);
        return;
      }
      if (entry) {
        const row = diaryRow(food, grams, meal, entry.date);
        await db.update('diary', entry.id, row);
        app.toast('Actualizado ✓');
      } else {
        await db.insert('diary', diaryRow(food, grams, meal, date));
        app.toast(`Agregado a ${MEALS.find((x) => x.id === meal)?.label} ✓`);
      }
      app.bump();
      app.closeSheet();
    } catch (e) { app.toast(e.message, 'error'); setBusy(false); }
  };

  const remove = async () => {
    if (!confirm('¿Eliminar este registro?')) return;
    await db.remove('diary', entry.id);
    app.bump(); app.closeSheet(); app.toast('Eliminado');
  };

  const saveAsMine = async () => {
    const { key, id, ref, tags, max, ...rest } = food;
    await db.insert('foods', {
      name: rest.name, brand: rest.brand || null, barcode: rest.barcode || null,
      serving_g: rest.serving_g || null, serving_label: rest.serving_label || null, unit: !!rest.unit,
      kcal: r1(rest.kcal), protein: r1(rest.protein), carbs: r1(rest.carbs), fat: r1(rest.fat), fiber: r1(rest.fiber),
      source: 'custom',
    });
    app.bump(); app.toast('Guardado en Mis alimentos ⭐');
  };

  const chips = unit === 'serving' ? ['0.5', '1', '1.5', '2', '3'] : ['50', '100', '150', '200', '250'];

  return html`
    <div class="stack">
      <div class="muted small">${food.brand ? food.brand + ' · ' : ''}${SOURCE_LABEL[food.source] || ''}${food.barcode ? ' · ' + food.barcode : ''}</div>
      <div class="big-kcal"><strong>${r0(m.kcal)}</strong> kcal</div>
      <div class="macro-grid">
        <div class="mg p"><b>${r1(m.protein)} g</b><span>Proteína</span></div>
        <div class="mg c"><b>${r1(m.carbs)} g</b><span>Carbos</span></div>
        <div class="mg f"><b>${r1(m.fat)} g</b><span>Grasa</span></div>
        <div class="mg"><b>${r1(m.fiber)} g</b><span>Fibra</span></div>
      </div>

      <div class="amount">
        <input type="number" inputmode="decimal" min="0" step="any" value=${amount} onInput=${(e) => setAmount(e.target.value)} aria-label="Cantidad" />
        ${hasServing
          ? html`<${Segmented} value=${unit} onChange=${switchUnit} options=${[{ id: 'serving', label: food.serving_label || 'porción' }, { id: 'g', label: 'gramos' }]} />`
          : html`<span class="muted">gramos</span>`}
      </div>
      <div class="chips">${chips.map((c) => html`<button class=${'chip' + (amount === c ? ' on' : '')} onClick=${() => setAmount(c)}>${unit === 'serving' ? c.replace('.', ',') + ' ×' : c + ' g'}</button>`)}</div>
      ${unit === 'serving' && html`<div class="muted small">= ${r0(grams)} g</div>`}

      ${mode !== 'pick' && html`
        <${Field} label="Comida">
          <div class="chips">${MEALS.map((x) => html`<button class=${'chip' + (meal === x.id ? ' on' : '')} onClick=${() => setMeal(x.id)}>${x.icon} ${x.label}</button>`)}</div>
        <//>`}

      <button class="btn primary" disabled=${busy} onClick=${submit}>
        ${mode === 'pick' ? 'Agregar ingrediente' : entry ? 'Guardar cambios' : 'Agregar'}
      </button>
      ${entry && html`<button class="btn danger ghost" onClick=${remove}><${Icon} name="trash" size=${16} /> Eliminar</button>`}
      ${['off', 'usda', 'ai'].includes(food.source) && html`<button class="btn ghost" onClick=${saveAsMine}><${Icon} name="star" size=${16} /> Guardar en Mis alimentos</button>`}

      <details class="per100">
        <summary>Valores por 100 g</summary>
        <div class="muted small">${r0(food.kcal)} kcal · P ${r1(food.protein)} · C ${r1(food.carbs)} · G ${r1(food.fat)} · Fibra ${r1(food.fiber)}</div>
      </details>
    </div>`;
}

// Alta / edición de alimento propio.
export function CreateFoodForm({ initial, existing, onSaved }) {
  const app = useApp();
  const e = existing;
  const [f, setF] = useState({
    name: e?.name || initial?.name || '', brand: e?.brand || initial?.brand || '', barcode: e?.barcode || initial?.barcode || '',
    basis: 'per100', serving_g: e?.serving_g || '', serving_label: e?.serving_label || '',
    kcal: e?.kcal ?? '', protein: e?.protein ?? '', carbs: e?.carbs ?? '', fat: e?.fat ?? '', fiber: e?.fiber ?? '',
  });
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.name.trim()) return app.toast('Poné un nombre', 'error');
    const sg = num(f.serving_g);
    if (f.basis === 'serving' && !sg) return app.toast('Indicá cuántos gramos tiene la porción', 'error');
    const k = f.basis === 'serving' ? 100 / sg : 1;
    let kcal = num(f.kcal) * k;
    const protein = num(f.protein) * k, carbs = num(f.carbs) * k, fat = num(f.fat) * k;
    if (!kcal) kcal = protein * 4 + carbs * 4 + fat * 9;
    const row = {
      name: f.name.trim(), brand: f.brand.trim() || null, barcode: f.barcode.trim() || null,
      serving_g: sg || null, serving_label: f.serving_label.trim() || (sg ? 'porción' : null), unit: !!sg,
      kcal: r1(kcal), protein: r1(protein), carbs: r1(carbs), fat: r1(fat), fiber: r1(num(f.fiber) * k), source: 'custom',
    };
    setBusy(true);
    try {
      const saved = e ? await db.update('foods', e.id, row) : await db.insert('foods', row);
      app.bump();
      app.toast(e ? 'Alimento actualizado ✓' : 'Alimento creado ✓');
      onSaved?.(saved);
    } catch (err) { app.toast(err.message, 'error'); }
    setBusy(false);
  };

  return html`
    <div class="stack">
      <${Field} label="Nombre"><input value=${f.name} onInput=${set('name')} placeholder="Ej: Yogur bebible Ser" /><//>
      <div class="grid2">
        <${Field} label="Marca"><input value=${f.brand} onInput=${set('brand')} /><//>
        <${Field} label="Código de barras"><input inputmode="numeric" value=${f.barcode} onInput=${set('barcode')} /><//>
      </div>
      <div class="grid2">
        <${Field} label="Porción (g)"><input type="number" inputmode="decimal" value=${f.serving_g} onInput=${set('serving_g')} placeholder="Ej: 30" /><//>
        <${Field} label="Nombre porción"><input value=${f.serving_label} onInput=${set('serving_label')} placeholder="Ej: 1 barrita" /><//>
      </div>
      <${Field} label="Los valores que cargás son…">
        <${Segmented} value=${f.basis} onChange=${(v) => setF({ ...f, basis: v })} options=${[{ id: 'per100', label: 'Por 100 g' }, { id: 'serving', label: 'Por porción' }]} />
      <//>
      <div class="grid2">
        <${Field} label="Calorías"><input type="number" inputmode="decimal" value=${f.kcal} onInput=${set('kcal')} placeholder="auto" /><//>
        <${Field} label="Proteína (g)"><input type="number" inputmode="decimal" value=${f.protein} onInput=${set('protein')} /><//>
        <${Field} label="Carbohidratos (g)"><input type="number" inputmode="decimal" value=${f.carbs} onInput=${set('carbs')} /><//>
        <${Field} label="Grasas (g)"><input type="number" inputmode="decimal" value=${f.fat} onInput=${set('fat')} /><//>
        <${Field} label="Fibra (g)"><input type="number" inputmode="decimal" value=${f.fiber} onInput=${set('fiber')} /><//>
      </div>
      <button class="btn primary" disabled=${busy} onClick=${save}>${e ? 'Guardar cambios' : 'Crear alimento'}</button>
    </div>`;
}

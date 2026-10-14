import { html, useState } from '../lib.js';
import { useApp } from '../util.js';
import { Icon, Segmented } from '../components.js';
import { PlanView } from './plan.js';
import { CoachCard } from './coach.js';
import { RecipesView } from './recipes.js';
import { hasPlan, hasNutrition, engineOf, routines, systemSections, shoppingOf, rulesOf, aiNutritionToPlan } from '../gym-data.js';
import { generateNutritionPlan, hasAI } from '../ai.js';
import { NoAiKey } from './ai-log.js';
import { Field, Spinner } from '../components.js';
import { isoDate } from '../util.js';

export function ComidaView() {
  const [seg, setSeg] = useState(() => (location.hash === '#plan' ? 'plan' : location.hash === '#recetas' ? 'recetas' : 'sistema'));
  return html`
    <div class="view">
      <h1 class="view-title d">Plan</h1>
      <${Segmented} value=${seg} onChange=${setSeg} options=${[{ id: 'sistema', label: 'Mi sistema' }, { id: 'plan', label: 'Generador' }, { id: 'recetas', label: 'Recetas' }]} />
      <${CoachCard} />
      ${seg === 'sistema' && html`<${Sistema} />`}
      ${seg === 'plan' && html`<${PlanView} embedded />`}
      ${seg === 'recetas' && html`<${RecipesView} embedded />`}
    </div>`;
}

const Rows = ({ rows }) => html`<ul class="exlist">${rows.map((e) => (Array.isArray(e) ? html`<li><span>${e[0]}</span><span>${e[1]}</span></li>` : html`<li><span>${e}</span></li>`))}</ul>`;

function Sistema() {
  const app = useApp();
  const { targets, profile, H } = app;
  if (!hasNutrition(H)) return html`<${NutritionWizard} />`;
  const sections = systemSections(H);
  const shopping = shoppingOf(H);
  const rules = rulesOf(H);
  const compras = profile.gym?.compras || {};
  const saveCompras = (c) => app.saveProfile({ ...profile, gym: { ...(profile.gym || {}), compras: c } }).catch((e) => app.toast(e.message, 'error'));
  const toggle = (it) => saveCompras({ ...compras, [it]: !compras[it] });
  const total = shopping.reduce((a, [, its]) => a + its.length, 0);
  const done = shopping.reduce((a, [, its]) => a + its.filter((i) => compras[i]).length, 0);
  const card = (x) => html`<section class="card"><h3 class="d big">${x.title}</h3>${x.text && html`<p class="small muted">${x.text}</p>`}${x.rows?.length > 0 && html`<${Rows} rows=${x.rows} />`}</section>`;

  const N = H.nutrition;
  const redo = () => app.openSheet(html`<${NutritionWizard} onDone=${() => app.closeSheet()} />`, 'Nutricionista IA');
  return html`
    ${N && html`<section class="card stack accent-card">
      <div class="wizard-head"><span class="coach-avatar"><${Icon} name="sparkles" size=${20} /></span>
        <div><b>${N.name}</b><p class="small muted">Plan de tu nutricionista IA</p></div></div>
      ${N.explanation && html`<p class="small">${N.explanation}</p>`}
      <button class="btn ghost small" onClick=${redo}><${Icon} name="refresh" size=${16} /> Rehacer con la nutricionista IA</button>
    </section>`}
    ${sections[0] && card(sections[0])}

    ${targets && html`<section class="card">
      <h3 class="d big">Números</h3>
      <p class="small muted">La proteína es fija; las calorías se ajustan según el promedio semanal del peso.</p>
      <${Rows} rows=${[['Calorías', `${targets.kcal} kcal`], ['Proteína', `${targets.protein} g`], ['Grasas', `${targets.fat} g`], ['Carbohidratos', `${targets.carbs} g`]]} />
      <p class="small muted pad-top">Dos semanas bajando más de 1 kg: sumá 150 kcal. Dos semanas sin bajar: restá 150 kcal o sumá pasos (Perfil → Ajustes avanzados).</p>
    </section>`}

    ${sections.slice(1, 2).map(card)}

    ${shopping.length > 0 && html`<section class="card stack">
      <div class="water-head"><h3 class="d big">Lista de compras</h3><span class="muted small">${done}/${total}</span></div>
      ${shopping.map(([cat, its]) => html`
        <h4 class="section-title">${cat}</h4>
        <div class="list">${its.map((it) => html`<label class=${'row check-row' + (compras[it] ? ' done' : '')}>
          <input type="checkbox" checked=${!!compras[it]} onChange=${() => toggle(it)} />
          <div class="row-main"><div class="row-title">${it}</div></div>
        </label>`)}</div>`)}
      <button class="btn ghost" onClick=${() => confirm('¿Empezar una compra nueva? Se desmarca toda la lista.') && saveCompras({})}><${Icon} name="refresh" size=${16} /> Nueva compra</button>
      <p class="small muted">Para las compras exactas según un plan generado, usá Plan → Lista de compras.</p>
    </section>`}

    ${sections.slice(2).map(card)}

    ${rules.length > 0 && html`<section class="card">
      <h3 class="d big">Reglas innegociables</h3>
      <ol class="rules">${rules.map((r) => html`<li>${r}</li>`)}</ol>
    </section>`}`;
}

const GOALS_N = [
  { id: 'cut', label: 'Bajar grasa', goal: 'cut' },
  { id: 'muscle', label: 'Ganar músculo', goal: 'lean_bulk' },
  { id: 'recomp', label: 'Tonificar', goal: 'recomp' },
  { id: 'keep', label: 'Mantener', goal: 'maintain' },
];

// Nutricionista IA: según el objetivo calcula calorías/macros y arma el plan de comida.
function NutritionWizard({ onDone }) {
  const app = useApp();
  const { H, profile } = app;
  const [f, setF] = useState({ goal: 'cut', detail: '', mealsPerDay: '4', likes: '', cooking: 'normal', notes: '' });
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (!hasAI(profile)) return html`<section class="card stack"><p>Para que la nutricionista IA arme tu plan, primero activá la IA:</p><${NoAiKey} /></section>`;

  const training = engineOf(H) === 'weekly'
    ? `${H.plan.week.filter((w) => w.kind === 'gym').length} días de gym por semana (${routines(H).map((r) => r.name).join(', ')})`
    : engineOf(H) === 'guardia' ? 'Gym 4 rutinas en rotación con guardias de 24 h' : '';

  const run = async () => {
    setBusy(true); setOut(null);
    try {
      const g = GOALS_N.find((x) => x.id === f.goal);
      const raw = await generateNutritionPlan(profile, app.targets, { ...f, goal: g.label, training });
      setOut(aiNutritionToPlan(raw));
    } catch (e) { app.toast(e.message, 'error'); }
    setBusy(false);
  };
  const use = async () => {
    const g = GOALS_N.find((x) => x.id === f.goal);
    const t = out.targets;
    await app.saveProfile({
      ...profile, goal: g.goal,
      nutrition: { ...out, start: isoDate() },
      ...(t.kcal ? { useManual: true, manual: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat } } : {}),
    });
    app.toast('¡Tu plan de comida está listo! 🥗');
    onDone?.();
  };

  if (out) return html`<section class="card stack accent-card pop-in">
    <h3 class="d big">${out.name}</h3>
    <div class="target-kcal"><b>${out.targets.kcal}</b> kcal por día</div>
    <div class="macro-grid">
      <div class="mg p"><b>${out.targets.protein} g</b><span>Proteína</span></div>
      <div class="mg c"><b>${out.targets.carbs} g</b><span>Carbos</span></div>
      <div class="mg f"><b>${out.targets.fat} g</b><span>Grasa</span></div>
      <div class="mg"><b>${out.meals.reduce((a, m) => a + m.options.length, 0)}</b><span>Opciones</span></div>
    </div>
    ${out.explanation && html`<p class="small">${out.explanation}</p>`}
    ${out.meals.map((m) => html`<details><summary>${m.t} · ${m.options.length} opciones</summary><ul class="exlist">${m.options.map((o) => html`<li><span>${o.t}</span></li>`)}</ul></details>`)}
    <p class="small muted">Al usarlo, estas calorías y macros pasan a ser tu objetivo diario (los podés cambiar en Perfil → Opciones avanzadas).</p>
    <div class="grid2"><button class="btn ghost" onClick=${() => setOut(null)}>Ajustar</button><button class="btn primary" onClick=${use}>Usar este plan</button></div>
  </section>`;

  return html`<section class="card stack">
    <div class="wizard-head"><span class="coach-avatar"><${Icon} name="sparkles" size=${20} /></span>
      <div><b>Tu nutricionista IA</b><p class="small muted">Te dice cuántas calorías y proteína necesitás para tu objetivo y te arma las comidas, las compras y los hábitos.${training ? ' Tiene en cuenta tu entrenamiento.' : ''}</p></div></div>
    <${Field} label="¿Cuál es tu objetivo?"><${Segmented} value=${f.goal} onChange=${(v) => setF({ ...f, goal: v })} options=${GOALS_N} /><//>
    <${Field} label="Contame un poco más (opcional)"><input placeholder="Ej: bajar 5 kg para el verano sin perder fuerza" value=${f.detail} onInput=${set('detail')} /><//>
    <div class="grid2">
      <${Field} label="Comidas por día"><select value=${f.mealsPerDay} onChange=${set('mealsPerDay')}>${[3, 4, 5].map((n) => html`<option value=${n}>${n} comidas</option>`)}</select><//>
      <${Field} label="Para cocinar"><select value=${f.cooking} onChange=${set('cooking')}>
        <option value="poco tiempo">Poco tiempo</option><option value="normal">Normal</option><option value="me gusta cocinar">Me gusta cocinar</option></select><//>
    </div>
    <${Field} label="Gustos, lo que no comés o alergias"><input placeholder="Ej: no como pescado, me encanta lo dulce, sin lactosa" value=${f.likes} onInput=${set('likes')} /><//>
    <button class="btn primary big" disabled=${busy} onClick=${run}><${Icon} name="sparkles" size=${18} /> ${busy ? 'Armando tu plan…' : 'Armar mi plan de comida'}</button>
    ${busy && html`<${Spinner} label="La nutricionista está calculando tus calorías y armando tus comidas…" />`}
  </section>`;
}

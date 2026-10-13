import { html, useState } from '../lib.js';
import { useApp } from '../util.js';
import { Icon, Segmented } from '../components.js';
import { PlanView } from './plan.js';
import { CoachCard } from './coach.js';
import { RecipesView } from './recipes.js';
import { hasPlan, systemSections, shoppingOf, rulesOf } from '../gym-data.js';

export function ComidaView() {
  const [seg, setSeg] = useState(() => (location.hash === '#plan' ? 'plan' : location.hash === '#recetas' ? 'recetas' : 'sistema'));
  return html`
    <div class="view">
      <h1 class="view-title d">Comida</h1>
      <${Segmented} value=${seg} onChange=${setSeg} options=${[{ id: 'sistema', label: 'Mi sistema' }, { id: 'plan', label: 'Plan' }, { id: 'recetas', label: 'Recetas' }]} />
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
  if (!hasPlan(H)) return html`<section class="card stack"><p>Todavía no tenés un sistema armado. En la pestaña <b>Gym</b> la IA arma tu plan de entrenamiento y comida en segundos.</p><button class="btn primary" onClick=${() => app.setTab('gym')}>Armar mi plan</button></section>`;
  const sections = systemSections(H);
  const shopping = shoppingOf(H);
  const rules = rulesOf(H);
  const compras = profile.gym?.compras || {};
  const saveCompras = (c) => app.saveProfile({ ...profile, gym: { ...(profile.gym || {}), compras: c } }).catch((e) => app.toast(e.message, 'error'));
  const toggle = (it) => saveCompras({ ...compras, [it]: !compras[it] });
  const total = shopping.reduce((a, [, its]) => a + its.length, 0);
  const done = shopping.reduce((a, [, its]) => a + its.filter((i) => compras[i]).length, 0);
  const card = (x) => html`<section class="card"><h3 class="d big">${x.title}</h3>${x.text && html`<p class="small muted">${x.text}</p>`}${x.rows?.length > 0 && html`<${Rows} rows=${x.rows} />`}</section>`;

  return html`
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

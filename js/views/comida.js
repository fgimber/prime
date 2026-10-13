import { html, useState } from '../lib.js';
import { useApp } from '../util.js';
import { Icon, Segmented } from '../components.js';
import { PlanView } from './plan.js';
import { CoachCard } from './coach.js';
import { RecipesView } from './recipes.js';
import { SISTEMA, TANDA, COMPRAS, EN_CASA, PLATOS_5, PLAN_B, OPT, REGLAS } from '../gym-data.js';

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
  const { targets, profile } = app;
  const compras = profile.gym?.compras || {};
  const saveCompras = (c) => app.saveProfile({ ...profile, gym: { ...(profile.gym || {}), compras: c } }).catch((e) => app.toast(e.message, 'error'));
  const toggle = (it) => saveCompras({ ...compras, [it]: !compras[it] });
  const total = COMPRAS.reduce((a, [, its]) => a + its.length, 0);
  const done = COMPRAS.reduce((a, [, its]) => a + its.filter((i) => compras[i]).length, 0);

  return html`
    <section class="card">
      <h3 class="d big">El sistema</h3>
      <p class="small">No pensás qué comer: lo decide la rotación.</p>
      <${Rows} rows=${SISTEMA} />
      <p class="small muted pad-top">Cada comida lleva una porción de proteína del tamaño de tu mano abierta. En <b>Hoy</b> y en <b>Gym</b> ves qué toca comer en cada momento.</p>
    </section>

    ${targets && html`<section class="card">
      <h3 class="d big">Números</h3>
      <p class="small muted">La proteína es fija; las calorías se ajustan según el promedio semanal del peso.</p>
      <${Rows} rows=${[['Calorías', `${targets.kcal} kcal`], ['Proteína', `${targets.protein} g`], ['Grasas', `${targets.fat} g`], ['Carbohidratos', `${targets.carbs} g`]]} />
      <p class="small muted pad-top">Una comida libre por semana. Dos semanas bajando más de 1 kg: sumá 150 kcal. Dos semanas sin bajar: restá 150 kcal o sumá pasos (Perfil → Ajustes avanzados).</p>
    </section>`}

    <section class="card">
      <h3 class="d big">La tanda</h3>
      <p class="small muted">Lo que cocinás cada franco 2. Alcanza para la cena de ese día, 2 tuppers de guardia y el almuerzo del franco 1.</p>
      <${Rows} rows=${TANDA} />
    </section>

    <section class="card stack">
      <div class="water-head"><h3 class="d big">Lista de compras</h3><span class="muted small">${done}/${total}</span></div>
      <p class="small muted">Compra grande una vez por mes. Al llegar, separá el pollo y la carne en bolsas de 1 kg y 500 g y freezalas: así cada tanda es sacar una bolsa.</p>
      ${COMPRAS.map(([cat, its]) => html`
        <h4 class="section-title">${cat}</h4>
        <div class="list">${its.map((it) => html`<label class=${'row check-row' + (compras[it] ? ' done' : '')}>
          <input type="checkbox" checked=${!!compras[it]} onChange=${() => toggle(it)} />
          <div class="row-main"><div class="row-title">${it}</div></div>
        </label>`)}</div>`)}
      <button class="btn ghost" onClick=${() => confirm('¿Empezar un mes nuevo? Se desmarca toda la lista.') && saveCompras({})}><${Icon} name="refresh" size=${16} /> Nuevo mes</button>
      <p class="small muted">Para las compras exactas según un plan generado, usá Plan → Lista de compras.</p>
    </section>

    <section class="card">
      <h3 class="d big">Comiendo en casa</h3>
      <p class="small muted">No tenés que cambiar lo que se cocina en casa. Usá esto:</p>
      <${Rows} rows=${EN_CASA} />
    </section>

    <section class="card">
      <h3 class="d big">Platos de 5 minutos</h3>
      <p class="small muted">Para cuando no hay nada hecho. Todos con 35–45 g de proteína.</p>
      <${Rows} rows=${PLATOS_5} />
    </section>

    <section class="card">
      <h3 class="d big">Plan B: no cociné</h3>
      <p class="small muted">Si no vas a estar el franco 2, cociná la tanda el franco 1 a la noche: dura 3–4 días en la heladera. Si igual no pudiste, en Gym tocá "Hoy no puedo cocinar" y seguí este orden:</p>
      <${Rows} rows=${PLAN_B} />
      <p class="small muted pad-top">Nunca facturas, empanadas ni pizza como reemplazo.</p>
    </section>

    <section class="card">
      <h3 class="d big">Cenas para los dos</h3>
      <p class="small muted">Rotan solas. Hacé doble y te sobra para el día siguiente.</p>
      <${Rows} rows=${OPT.rec} />
    </section>

    <section class="card">
      <h3 class="d big">Reglas innegociables</h3>
      <ol class="rules">${REGLAS.map((r) => html`<li>${r}</li>`)}</ol>
    </section>`;
}

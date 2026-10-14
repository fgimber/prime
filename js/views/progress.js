import { html, useState, useEffect } from '../lib.js';
import { db } from '../store.js';
import { useApp, r0, r1, num, isoDate, addDays, parseISO, shortDate } from '../util.js';
import { adaptiveTdee } from '../nutrition.js';
import { Icon, Field, LineChart, BarChart, Empty, Spinner } from '../components.js';
import { streaks, weeks, status, startOf, hasPlan } from '../gym-data.js';
import { fmtLong } from './gym.js';

export function ProgressView() {
  const app = useApp();
  const { targets, profile } = app;
  const [weights, setWeights] = useState(null);
  const [daily, setDaily] = useState({});
  const [range, setRange] = useState(90);
  const [form, setForm] = useState({ date: isoDate(), kg: '', bodyfat: '', waist: '' });

  useEffect(() => {
    db.list('weights', { order: 'date', asc: true }).then(setWeights).catch((e) => app.toast(e.message, 'error'));
    db.list('diary', { gte: { date: addDays(isoDate(), -27) } }).then((rows) => {
      const d = {};
      rows.forEach((r) => { d[r.date] = d[r.date] || { kcal: 0, protein: 0, carbs: 0, fat: 0 }; ['kcal', 'protein', 'carbs', 'fat'].forEach((k) => (d[r.date][k] += +r[k] || 0)); });
      setDaily(d);
    }).catch(() => {});
  }, [app.version]);

  const saveWeight = async () => {
    const kg = num(form.kg);
    if (!kg) return app.toast('Ingresá tu peso', 'error');
    try {
      await db.upsert('weights', { date: form.date, kg, bodyfat: num(form.bodyfat) || null, waist: num(form.waist) || null }, 'user_id,date');
      // mantener el perfil al día con el último peso
      if (form.date >= (weights?.at(-1)?.date || '')) {
        const p = { ...profile, weight: kg };
        if (num(form.bodyfat)) p.bodyfat = num(form.bodyfat);
        await app.saveProfile(p);
      }
      setForm({ ...form, kg: '', bodyfat: '', waist: '' });
      app.bump(); app.toast('Peso registrado ✓ (objetivos actualizados)');
    } catch (e) { app.toast(e.message, 'error'); }
  };

  const delWeight = async (w) => {
    if (!confirm(`¿Borrar el registro del ${shortDate(w.date)}?`)) return;
    await db.remove('weights', w.id); app.bump();
  };

  if (weights === null) return html`<div class="view"><${Spinner} /></div>`;

  const from = range ? addDays(isoDate(), -range) : '0000';
  const pts = weights.filter((w) => w.date >= from).map((w) => ({ x: w.date, y: +w.kg }));
  const last = weights.at(-1);
  const change = (days) => {
    const ref = [...weights].reverse().find((w) => w.date <= addDays(last.date, -days));
    return ref ? +last.kg - +ref.kg : null;
  };

  const days14 = Array.from({ length: 14 }, (_, i) => addDays(isoDate(), i - 13));
  const bars = days14.map((d) => ({ v: daily[d]?.kcal || 0, short: parseISO(d).toLocaleDateString('es-AR', { weekday: 'narrow' }), label: shortDate(d) }));
  const logged = days14.filter((d) => (daily[d]?.kcal || 0) > 300);
  const avg = (k) => (logged.length ? logged.reduce((a, d) => a + daily[d][k], 0) / logged.length : 0);
  const kcalByDay = Object.fromEntries(Object.entries(daily).map(([d, v]) => [d, v.kcal]));
  const adapt = adaptiveTdee(weights.filter((w) => w.date >= addDays(isoDate(), -27)), kcalByDay);

  const streak = streaks(app.H);
  const wmap = Object.fromEntries(weights.map((w) => [w.date, +w.kg]));
  const wks = weeks(app.H, wmap);
  const okAll = Object.keys(app.H.days).filter((k) => k >= startOf(app.H) && status(k, app.H) === 'ok').length;
  const prime = targets?.prime;
  const primeW = num(profile.primeWeight);
  const start = weights[0];
  const cur = last ? +last.kg : num(profile.weight);
  const progressPct = primeW && start && +start.kg !== primeW ? Math.max(0, Math.min(100, ((+start.kg - cur) / (+start.kg - primeW)) * 100)) : null;
  const fmtChange = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} kg`);

  return html`
    <div class="view">
      <h1 class="view-title">Progreso</h1>

      ${primeW > 0 && html`
        <section class="card prime">
          <div class="prime-head"><${Icon} name="trophy" /><h3>Vuelta a mi prime</h3></div>
          <div class="prime-stats">
            <div><b>${r1(cur)}</b><span>Actual</span></div>
            <div><b>${r1(primeW)}</b><span>Prime</span></div>
            <div><b>${r1(Math.abs(cur - primeW))}</b><span>${cur > primeW ? 'kg por bajar' : cur < primeW ? 'kg por subir' : '¡Llegaste!'}</span></div>
          </div>
          ${progressPct != null && html`<div class="bar gold"><div style=${{ width: progressPct + '%' }}></div></div><div class="muted small">${r0(progressPct)}% del camino desde ${shortDate(start.date)}</div>`}
          ${prime?.eta && html`<p class="small">Al ritmo de tu objetivo (${prime.weeks.toFixed(0)} semanas) llegarías cerca del <b>${prime.eta.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}</b>.</p>`}
          ${prime?.requiredKgWeek != null && html`<p class="small muted">Para tu fecha objetivo necesitás ${Math.abs(prime.requiredKgWeek).toFixed(2).replace('.', ',')} kg/semana.</p>`}
          ${profile.primeBodyfat && html`<p class="small muted">Grasa corporal objetivo: ${profile.primeBodyfat}%${last?.bodyfat ? ` · actual ${last.bodyfat}%` : ''}</p>`}
        </section>`}

      <section class="card stack">
        <h3><${Icon} name="scale" size=${18} /> Registrar peso</h3>
        <div class="grid2">
          <${Field} label="Fecha"><input type="date" value=${form.date} onInput=${(e) => setForm({ ...form, date: e.target.value })} /><//>
          <${Field} label="Peso (kg)"><input type="number" inputmode="decimal" step="0.1" value=${form.kg} onInput=${(e) => setForm({ ...form, kg: e.target.value })} placeholder=${last ? last.kg : ''} /><//>
          <${Field} label="% grasa (opc.)"><input type="number" inputmode="decimal" step="0.1" value=${form.bodyfat} onInput=${(e) => setForm({ ...form, bodyfat: e.target.value })} /><//>
          <${Field} label="Cintura cm (opc.)"><input type="number" inputmode="decimal" step="0.5" value=${form.waist} onInput=${(e) => setForm({ ...form, waist: e.target.value })} /><//>
        </div>
        <button class="btn primary" onClick=${saveWeight}>Guardar</button>
      </section>

      <section class="card stack">
        <div class="water-head"><h3>Peso</h3>
          <select class="mini-select" value=${range} onChange=${(e) => setRange(+e.target.value)}>
            <option value="30">30 días</option><option value="90">90 días</option><option value="365">1 año</option><option value="0">Todo</option>
          </select></div>
        <${LineChart} points=${pts} goal=${primeW || null} />
        ${last && html`<div class="prime-stats small-stats">
          <div><b>${fmtChange(change(7))}</b><span>7 días</span></div>
          <div><b>${fmtChange(change(30))}</b><span>30 días</span></div>
          <div><b>${fmtChange(start ? +last.kg - +start.kg : null)}</b><span>Total</span></div>
        </div>`}
      </section>

      ${hasPlan(app.H) && html`<section class="card stack">
        <h3><${Icon} name="flame" size=${18} /> Constancia</h3>
        <div class="prime-stats small-stats">
          <div><b class="d">${streak.cur}</b><span>Racha actual</span></div>
          <div><b class="d">${streak.best}</b><span>Mejor racha</span></div>
          <div><b class="d">${okAll}</b><span>Días 100%</span></div>
        </div>
        ${wks.length ? html`<div class="tscroll"><table class="wk">
          <thead><tr><th>Sem.</th><th>Desde</th><th>Entrenados</th><th>100%</th><th>Kg prom.</th></tr></thead>
          <tbody>${[...wks].reverse().map((w) => html`<tr><td>${w.n}</td><td>${fmtLong(w.from)}</td><td>${w.tr}/7</td><td>${w.okd}/7</td><td>${w.avg != null ? w.avg.toFixed(1) : '—'}</td></tr>`)}</tbody>
        </table></div>` : html`<p class="muted small">La semana 1 arranca el ${fmtLong(startOf(app.H))}.</p>`}
        <p class="muted small">Ritmo sano: 0,6–0,8 kg por semana. Solo manda el promedio semanal.</p>
      </section>`}

      <section class="card stack">
        <h3>Calorías · últimos 14 días</h3>
        <${BarChart} bars=${bars} target=${targets?.kcal} />
        ${logged.length ? html`<div class="prime-stats small-stats">
          <div><b>${r0(avg('kcal'))}</b><span>kcal prom.</span></div>
          <div><b>${r0(avg('protein'))} g</b><span>Proteína</span></div>
          <div><b>${logged.length}/14</b><span>días registrados</span></div>
        </div>` : html`<${Empty}>Registrá tus comidas para ver estadísticas.<//>`}
      </section>

      <section class="card stack">
        <h3>Tu gasto real (TDEE adaptativo)</h3>
        ${adapt ? html`
          <p>Según tu peso y lo que registraste en ${adapt.days} días, tu mantenimiento real ronda las <b>${adapt.tdee} kcal</b> (la fórmula estima ${targets?.tdee}).</p>
          <p class="muted small">Tendencia: ${adapt.kgPerWeek >= 0 ? '+' : ''}${adapt.kgPerWeek.toFixed(2)} kg/semana con un promedio de ${adapt.avgIntake} kcal. Si la diferencia es grande y sostenida, ajustá el objetivo manual en Perfil.</p>`
        : html`<p class="muted small">Necesito al menos 2 semanas con 3+ pesajes y 10+ días de comidas registradas para estimarlo.</p>`}
      </section>

      ${weights.length > 0 && html`<details class="card">
        <summary><b>Historial de pesajes (${weights.length})</b></summary>
        <div class="list flush">${[...weights].reverse().map((w) => html`<div class="row">
          <div class="row-main"><div class="row-title">${r1(w.kg)} kg</div><div class="row-sub muted">${shortDate(w.date)} ${parseISO(w.date).getFullYear()}${w.bodyfat ? ` · ${w.bodyfat}% grasa` : ''}${w.waist ? ` · cintura ${w.waist} cm` : ''}</div></div>
          <button class="icon-btn" onClick=${() => delWeight(w)} aria-label="Borrar"><${Icon} name="trash" size=${16} /></button>
        </div>`)}</div>
      </details>`}
    </div>`;
}

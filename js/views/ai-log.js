import { html, useState, useRef } from '../lib.js';
import { db, rpc, isCloud } from '../store.js';
import { useApp, r0, r1, num, sum, diaryRow } from '../util.js';
import { analyzeText, analyzePhoto, fileToBase64, itemToFood, hasAI } from '../ai.js';
import { Icon, Spinner, MacroPills } from '../components.js';

export function NoAiKey() {
  const app = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const redeem = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const ok = await rpc('redeem_invite', { code: code.trim() });
      if (ok) { await app.refreshAi(); app.toast('¡IA activada! 🎉'); }
      else app.toast('Código incorrecto', 'error');
    } catch (e) { app.toast(e.message, 'error'); }
    setBusy(false);
  };
  return html`<div class="card note stack">
    ${isCloud && html`
      <b>Activá la IA con tu código de invitación</b>
      <div class="coach-row invite-row">
        <input placeholder="Código (ej. PRIME…)" autocapitalize="characters" value=${code} onInput=${(e) => setCode(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && redeem()} />
        <button class="btn small primary" disabled=${busy || !code.trim()} onClick=${redeem}>Activar</button>
      </div>
      <p class="small muted">¿No tenés código? Pedíselo a quien te pasó la app, o usá tu propia key gratis:</p>`}
    ${!isCloud && html`<b>Activá la IA gratis</b>`}
    <p class="small">1. Entrá a <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a> con tu cuenta de Google.<br/>2. Tocá "Create API key" y copiala.<br/>3. Pegala en Perfil → Inteligencia artificial.</p>
    <button class="btn small" onClick=${() => { app.closeAll(); app.setTab('perfil'); }}>Ir a Perfil</button>
  </div>`;
}

// Lista editable de ítems devueltos por la IA (también la usan las recetas).
export function AiItems({ items, setItems }) {
  const upd = (i, patch) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const setGrams = (i, v) => {
    const it = items[i], g = num(v), k = it.grams ? g / it.grams : 0;
    if (!g) return upd(i, { _g: v });
    upd(i, { _g: undefined, grams: g, kcal: r1(it.kcal * k), protein: r1(it.protein * k), carbs: r1(it.carbs * k), fat: r1(it.fat * k), fiber: r1((it.fiber || 0) * k) });
  };
  return html`<div class="list">
    ${items.map((it, i) => html`
      <div class=${'row ai-row' + (it.off ? ' off' : '')}>
        <input type="checkbox" checked=${!it.off} onChange=${(e) => upd(i, { off: !e.target.checked })} aria-label="Incluir" />
        <div class="row-main">
          <input class="inline" value=${it.name} onInput=${(e) => upd(i, { name: e.target.value })} />
          <div class="row-sub"><${MacroPills} m=${it} compact /></div>
        </div>
        <div class="grams-in"><input type="number" inputmode="decimal" value=${it._g ?? it.grams} onInput=${(e) => setGrams(i, e.target.value)} /><small>g</small></div>
        <div class="row-side"><strong>${r0(it.kcal)}</strong><small class="muted">kcal</small></div>
      </div>`)}
  </div>`;
}

export function AiPanel({ date, meal }) {
  const app = useApp();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState(null);
  const [notes, setNotes] = useState('');
  const fileRef = useRef();

  if (!hasAI(app.profile)) return html`<${NoAiKey} />`;

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setPhoto(await fileToBase64(file)); setItems(null); } catch (err) { app.toast(err.message, 'error'); }
    e.target.value = '';
  };

  const analyze = async () => {
    if (!photo && !text.trim()) return app.toast('Describí la comida o sacale una foto', 'error');
    setBusy(true); setItems(null);
    try {
      const out = photo ? await analyzePhoto(app.profile, photo, text.trim()) : await analyzeText(app.profile, text.trim());
      setItems(out.items); setNotes(out.notes);
      if (!out.items.length) app.toast('No identifiqué alimentos. Probá con más detalle.', 'error');
    } catch (err) { app.toast(err.message, 'error'); }
    setBusy(false);
  };

  const chosen = (items || []).filter((i) => !i.off && i.grams > 0);
  const total = sum(chosen);

  const addAll = async () => {
    setBusy(true);
    try {
      await db.insertMany('diary', chosen.map((it) => diaryRow(itemToFood(it), it.grams, meal, date)));
      app.bump();
      app.toast(`${chosen.length} alimento(s) agregados ✓`);
      app.closeSheet();
    } catch (err) { app.toast(err.message, 'error'); setBusy(false); }
  };

  return html`
    <div class="stack">
      <textarea rows="3" placeholder=${photo ? 'Aclaración opcional (ej: "el arroz es integral, comí la mitad")' : 'Ej: 2 empanadas de carne, una ensalada de tomate y una coca zero'} value=${text} onInput=${(e) => setText(e.target.value)}></textarea>
      <input ref=${fileRef} type="file" accept="image/*" capture="environment" hidden onChange=${pick} />
      ${photo && html`<div class="photo-prev"><img src=${photo.preview} alt="Foto de la comida" /><button class="icon-btn" onClick=${() => setPhoto(null)} aria-label="Quitar foto"><${Icon} name="x" /></button></div>`}
      <div class="grid2">
        <button class="btn ghost" onClick=${() => fileRef.current.click()}><${Icon} name="camera" size=${18} /> ${photo ? 'Otra foto' : 'Foto'}</button>
        <button class="btn primary" disabled=${busy} onClick=${analyze}><${Icon} name="sparkles" size=${18} /> Analizar</button>
      </div>
      ${busy && !items && html`<${Spinner} label="La IA está analizando tu comida…" />`}
      ${items && items.length > 0 && html`
        <h3 class="section-title">Revisá y ajustá los gramos</h3>
        <${AiItems} items=${items} setItems=${setItems} />
        ${notes && html`<p class="muted small">💡 ${notes}</p>`}
        <div class="total-line"><span>Total</span><b>${r0(total.kcal)} kcal</b><${MacroPills} m=${total} /></div>
        <button class="btn primary" disabled=${busy || !chosen.length} onClick=${addAll}>Agregar ${chosen.length} al diario</button>
        <p class="muted small center">Las estimaciones por foto pueden tener ±20% de error. Ajustá los gramos si sabés el peso real.</p>
      `}
    </div>`;
}

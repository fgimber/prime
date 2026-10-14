import { html, useState } from '../lib.js';
import { useEffect } from '../lib.js';
import { auth, accounts, isCloud, rpc } from '../store.js';
import { unlock, biometricName, disableLock } from '../lock.js';
import { Icon } from '../components.js';
import { useApp } from '../util.js';
import { Field } from '../components.js';

export function AuthView() {
  const app = useApp();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const saved = isCloud ? accounts.list() : [];
  const back = isCloud ? accounts.returnTo() : null;
  const resume = async (a) => {
    setBusy(true);
    try { await accounts.switchTo(a.id); } catch (e) { app.toast(e.message, 'error'); setEmail(a.email); }
    setBusy(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'login') await auth.signIn(email.trim(), pw);
      else if (mode === 'signup') {
        const r = await auth.signUp(email.trim(), pw);
        if (!r.session) setMsg('Te mandé un email para confirmar la cuenta. Abrilo y volvé a entrar.');
        else if (invite.trim()) {
          // Activa la IA compartida para la cuenta nueva
          const ok = await rpc('redeem_invite', { code: invite.trim() }).catch(() => false);
          await app.refreshAi?.();
          app.toast(ok ? '¡Cuenta creada con IA activada! 🎉' : 'Cuenta creada. El código no es válido: podés ingresarlo después en Perfil.', ok ? 'ok' : 'error');
        }
      } else {
        await auth.resetPassword(email.trim());
        setMsg('Te mandé un email para restablecer la contraseña.');
      }
    } catch (err) {
      const m = err.message || String(err);
      app.toast(/Invalid login/i.test(m) ? 'Email o contraseña incorrectos' : m, 'error');
    }
    setBusy(false);
  };

  return html`
    <div class="auth">
      ${back && html`<button class="back-btn" disabled=${busy} onClick=${() => resume(back)}><${Icon} name="left" size=${18} /> Volver a ${back.name || back.email.split('@')[0]}</button>`}
      <div class="brand"><img src="icons/icon-192.png" alt="" width="72" height="72" class="app-icon" /><h1 class="d">Prime</h1><p class="muted">Calorías, macros y tu vuelta al prime.</p></div>
      ${saved.length > 0 && html`<div class="card stack">
        <b>${back ? 'O elegí una cuenta guardada' : 'Cuentas en este dispositivo'}</b>
        ${saved.map((a) => html`<button class="account-row" disabled=${busy} onClick=${() => resume(a)}>
          <span class="avatar">${(a.name || a.email || '?')[0].toUpperCase()}</span>
          <span class="txt"><b>${a.name || a.email.split('@')[0]}</b><small>${a.email}</small></span><${Icon} name="right" /></button>`)}
      </div>`}
      <form class="card stack" onSubmit=${submit}>
        <${Field} label="Email"><input type="email" autocomplete="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
        ${mode !== 'reset' && html`<${Field} label="Contraseña"><input type="password" autocomplete=${mode === 'login' ? 'current-password' : 'new-password'} minlength="6" required value=${pw} onInput=${(e) => setPw(e.target.value)} /><//>`}
        ${mode === 'signup' && html`<${Field} label="Código de invitación" hint="Te lo pasa quien te compartió la app. Activa la IA sin necesitar tu propia key."><input autocapitalize="characters" autocomplete="off" value=${invite} onInput=${(e) => setInvite(e.target.value)} placeholder="Opcional" /><//>`}
        <button class="btn primary" disabled=${busy}>${mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar email'}</button>
        ${msg && html`<p class="small note-inline">${msg}</p>`}
        <div class="auth-links">
          ${mode !== 'login' && html`<button type="button" class="link-btn" onClick=${() => setMode('login')}>Ya tengo cuenta</button>`}
          ${mode !== 'signup' && html`<button type="button" class="link-btn" onClick=${() => setMode('signup')}>Crear cuenta</button>`}
          ${mode === 'login' && html`<button type="button" class="link-btn" onClick=${() => setMode('reset')}>Olvidé mi contraseña</button>`}
        </div>
      </form>
    </div>`;
}

export function NewPasswordView({ onDone }) {
  const app = useApp();
  const [pw, setPw] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { await auth.updatePassword(pw); app.toast('Contraseña actualizada ✓'); onDone(); } catch (err) { app.toast(err.message, 'error'); }
  };
  return html`<div class="auth"><form class="card stack" onSubmit=${submit}>
    <h2>Nueva contraseña</h2>
    <${Field} label="Contraseña"><input type="password" autocomplete="new-password" minlength="6" required value=${pw} onInput=${(e) => setPw(e.target.value)} /><//>
    <button class="btn primary">Guardar</button>
  </form></div>`;
}

// Pantalla de bloqueo: Face ID en iPhone, Touch ID en Mac.
export function LockView({ onUnlock }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const name = biometricName();
  const tryUnlock = async () => {
    setBusy(true); setErr(null);
    try { if (await unlock()) onUnlock(); } catch (e) { setErr(e.name === 'NotAllowedError' ? 'Cancelado. Tocá el botón para reintentar.' : e.message); }
    setBusy(false);
  };
  useEffect(() => { tryUnlock(); }, []);
  const usePassword = async () => {
    if (!confirm('Se desactiva el bloqueo en este dispositivo y vas a tener que entrar con tu email y contraseña. ¿Seguir?')) return;
    disableLock();
    await auth.signOut();
    onUnlock();
  };
  return html`<div class="auth lock">
    <div class="brand"><img src="icons/icon-192.png" alt="" width="72" height="72" /><h1 class="d">Prime</h1><p class="muted">${app.user?.email || ''}</p></div>
    <div class="stack">
      <button class="btn primary big" disabled=${busy} onClick=${tryUnlock}><${Icon} name="face" size=${22} /> Desbloquear con ${name}</button>
      ${err && html`<p class="small center muted">${err}</p>`}
      <button class="link-btn center-btn" onClick=${usePassword}>Entrar con contraseña</button>
    </div>
  </div>`;
}

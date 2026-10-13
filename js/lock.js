// Bloqueo con Face ID (iPhone) / Touch ID (Mac) usando WebAuthn con el autenticador del dispositivo.
// Tu sesión de Supabase queda guardada en el dispositivo; esto pide tu biometría para abrir la app.
const KEY = 'prime:lock';

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function biometricAvailable() {
  try {
    return !!(window.PublicKeyCredential && window.isSecureContext && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch { return false; }
}

export function lockEnabled() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function biometricName() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'Face ID';
  if (/Macintosh/.test(ua)) return 'Touch ID';
  return 'biometría';
}

export async function enableLock(user) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Prime' },
      user: { id: new TextEncoder().encode(user.id).slice(0, 64), name: user.email || 'prime', displayName: user.email || 'Prime' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('No se pudo registrar la biometría');
  localStorage.setItem(KEY, JSON.stringify({ id: toB64(cred.rawId), user: user.id }));
}

export function disableLock() {
  try { localStorage.removeItem(KEY); } catch {}
}

export async function unlock() {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (!saved) return true;
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: fromB64(saved.id), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return !!res;
}

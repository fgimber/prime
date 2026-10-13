// Supabase Edge Function "ai": IA compartida.
// Usa la key de Gemini guardada como secreto (GEMINI_API_KEY), solo para miembros invitados,
// con límite diario por persona (ver supabase/shared-ai.sql). Deja pasar las respuestas en vivo (streaming).
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const fail = (code: number, message: string, status: string) =>
  new Response(JSON.stringify({ error: { code, message, status } }), { status: code, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const KEY = Deno.env.get('GEMINI_API_KEY');
  if (!KEY) return fail(500, 'CONFIG: falta el secreto GEMINI_API_KEY en Supabase.', 'CONFIG');
  const auth = req.headers.get('Authorization') || '';
  const rpc = (fn: string) => fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') || '', 'Content-Type': 'application/json' },
    body: '{}',
  });
  const c = await rpc('ai_consume');
  if (!c.ok) {
    const e = await c.json().catch(() => ({}));
    if (String(e.message || '').includes('USER_LIMIT')) return fail(429, 'USER_LIMIT: llegaste al límite diario de consultas de IA. Se renueva mañana.', 'USER_LIMIT');
    return fail(403, 'NOT_MEMBER: tu cuenta no tiene acceso a la IA compartida. Ingresá el código de invitación en Perfil.', 'NOT_MEMBER');
  }
  let b;
  try { b = await req.json(); } catch { await rpc('ai_refund'); return fail(400, 'Pedido inválido', 'BAD'); }
  const model = String(b.model || '');
  if (!/^gemini-[\w.-]+$/.test(model)) { await rpc('ai_refund'); return fail(400, 'Modelo inválido', 'BAD'); }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':' + (b.stream ? 'streamGenerateContent?alt=sse' : 'generateContent');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(b.payload || {}) });
  if (!r.ok) await rpc('ai_refund'); // los intentos fallidos no cuentan
  return new Response(r.body, { status: r.status, headers: { ...CORS, 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
});

// Supabase Edge Function "food-search": proxy al buscador de Open Food Facts.
// El navegador no puede llamarlo directo (no envía cabeceras CORS), así que pasa por acá.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const FIELDS = 'code,product_name,product_name_es,brands,nutriments,serving_quantity,serving_size';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 100);
  if (!q) return Response.json({ hits: [] }, { headers: CORS });
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=40&langs=es,en&fields=${FIELDS}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'PrimeApp/1.0 (uso personal)' } });
  return new Response(await r.text(), {
    status: r.status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
  });
});

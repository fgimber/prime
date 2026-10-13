# Prime · Volver al prime

App web instalable (PWA) que junta tu app de gimnasio "Volver al prime" (rutinas, guardias, tandas, racha) con el contador de calorías y macros.
Todo funciona con servicios **gratuitos** y sin instalar nada en la compu.

## Qué incluye

| Función | Cómo funciona |
|---|---|
| **Gym** (de "Volver al prime") | Racha de "días sin negociar", rotación de guardias 24x48 (guardia, franco 1 y franco 2), Push/Pull/Pierna/Brazo con sugerencia automática, rutina completa o mínima, running progresivo, circuito en casa, plan B, comida libre semanal y calendario de cumplimiento |
| **Comida → Mi sistema** | La tanda, la lista de compras del mes con checks, comer en casa, platos de 5 minutos, plan B, cenas rotativas, números y reglas |
| Registro diario por comida | Desayuno, almuerzo, merienda, cena y snacks, con anillo de calorías, barras de macros, fibra y agua |
| Metas de calorías y macros | Mifflin-St Jeor (+ Katch-McArdle si cargás tu % de grasa) × actividad, ajustado por objetivo. Proteína en g/kg (calculada sobre el peso prime si estás por encima), grasa mínima del 20 % y carbohidratos con el resto. También se pueden cargar a mano |
| Mi Prime 2024 | Peso, % de grasa y fecha objetivo: muestra el progreso, los kg que faltan y la fecha estimada de llegada |
| Buscador de alimentos | Base propia de unos 170 alimentos argentinos + Mis alimentos + Recetas + Open Food Facts + USDA |
| Escáner de código de barras | Cámara del celular (nativo en Android, ZXing en iPhone) + Open Food Facts. Si el producto no existe, lo cargás una vez y queda guardado |
| Recetas propias | Ingredientes con gramos, porciones y peso final cocido: calcula los macros por porción. También se pueden importar pegando el texto (con IA) |
| Plan de comidas automático | Algoritmo que elige alimentos y ajusta los gramos para cumplir tus macros; también hay un plan con IA. Incluye regenerar por comida, plan de 7 días, lista de compras y pasar el plan al diario |
| **Nutricionista IA** | Chat con una nutricionista experta en nutrición deportiva y general (Gemini). Conoce tus objetivos, lo que comiste y lo que te queda hoy, si estás de guardia o de franco, tu entrenamiento, tu plan y tus reglas. Responde "¿puedo comer esto?" con un veredicto (Sí / Con moderación / Mejor no), la porción exacta y cómo compensar. Acepta fotos y registra lo que sugiere con un toque. Está en Hoy y en Comida |
| IA (foto o texto) | Google Gemini: sacás una foto o escribís "2 empanadas y una coca zero" y desglosa cada alimento con gramos y macros, todo editable |
| Progreso | Gráfico de peso con la línea del prime, calorías de los últimos 14 días y TDEE adaptativo (tu gasto real según peso y registros) |
| Cuenta y sincronización | Login con email (Supabase): entrás desde cualquier dispositivo y tenés todo tu historial. Incluye backup a JSON |
| **Plan con IA para cualquier persona** | Pegás la rutina (o una foto), días disponibles, gustos y objetivo, y la IA arma la semana completa: qué rutina toca cada día, opciones de comida que rotan, hábitos, "Mi sistema", lista de compras y reglas. Cada usuario tiene su propio plan |
| **Varias cuentas** | Perfil → Cuenta y datos → **Agregar otra cuenta** (por ejemplo, tu novia). Se cambia de cuenta con un toque y cada una mantiene sus propios datos, plan, historial y chat, sin mezclarse |
| Face ID / Touch ID | Después de entrar una vez, la sesión queda guardada y la app se abre con Face ID (iPhone) o Touch ID (Mac). Se activa en Perfil → Cuenta y datos |
| Importar "Volver al prime" | Perfil → Importar (o desde la bienvenida): carga tus días, checks, rutinas, pesos, la rotación y tus números del plan |
| Offline / instalable | Service worker + manifest: se agrega a la pantalla de inicio como una app |

---

## Puesta en marcha (unos 15 minutos, una sola vez)

### 1. Base de datos y login: Supabase (gratis)

1. Creá una cuenta en **https://supabase.com** y después **New project** (elegí la región São Paulo, que es la más cercana a Argentina).
2. Andá a **SQL Editor → New query**, pegá todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y tocá **Run**.
3. Andá a **Project Settings → API** (o **Data API**) y copiá:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon / publishable key**
4. Pegalos en [`config.js`](config.js):
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
   Es seguro que esa key sea pública: la seguridad la dan las políticas RLS del schema (cada usuario solo ve sus datos).
5. *(Recomendado)* **Authentication → Sign In / Providers → Email**: desactivá **Confirm email** para no tener que confirmar por mail (la app es solo para vos).

### 2. Buscador confiable de Open Food Facts (Edge Function, gratis)

El buscador de texto de Open Food Facts no se puede llamar directo desde el navegador de forma confiable, así que esta función hace de intermediaria:

1. En Supabase andá a **Edge Functions → Deploy a new function → Via Editor**.
2. Nombre: `food-search`. Pegá el contenido de [`supabase/functions/food-search/index.ts`](supabase/functions/food-search/index.ts) y tocá **Deploy**.
3. En la configuración de la función, **desactivá "Verify JWT"** (es un buscador de datos públicos).

Sin este paso la app intenta el buscador viejo de forma directa, que a veces está saturado. El escáner de código de barras funciona igual en los dos casos.

### 3. Publicar la app: GitHub Pages (gratis, con HTTPS)

1. Creá una cuenta en **https://github.com** y un repositorio nuevo (por ejemplo `prime`), que puede ser **privado** si tenés GitHub Pro, o público (tus datos no están en el código, están en Supabase).
2. **Add file → Upload files** y arrastrá **todo el contenido** de esta carpeta `prime-app` (no la carpeta en sí). Después **Commit**.
3. Andá a **Settings → Pages → Source: Deploy from a branch → main / (root)** y guardá.
4. En 1–2 minutos queda en `https://TU-USUARIO.github.io/prime/`.
5. Volvé a Supabase → **Authentication → URL Configuration** y poné esa URL en **Site URL** y en **Redirect URLs** (sirve para los emails de recuperar la contraseña).

> Alternativas igual de gratis: Netlify (arrastrar la carpeta en app.netlify.com/drop) o Cloudflare Pages.

### 4. IA gratis: Google Gemini

1. Entrá a **https://aistudio.google.com/app/apikey** con tu cuenta de Google y tocá **Create API key**.
2. En la app: **Perfil → Inteligencia artificial**, pegá la key y guardá. Se guarda en tu perfil (protegido por RLS), así que la tenés en todos tus dispositivos.

El plan gratuito de Gemini alcanza de sobra para uso personal. Si Google renombra el modelo, lo podés cambiar en el mismo lugar (por defecto `gemini-3.8-flash`; si Google retira un modelo, la app usa automáticamente el que Google recomiende).

### 5. Instalarla en el celular

- **iPhone (Safari):** abrí la URL → Compartir → **Agregar a inicio**.
- **Android (Chrome):** abrí la URL → menú ⋮ → **Instalar app**.

La cámara (escáner y fotos) necesita HTTPS, y GitHub Pages ya lo trae.

---

### 6. Pasar tu historial de "Volver al prime"

1. Ya logueado en Prime, andá a **Perfil → Cuenta y datos → Importar** y elegí tu `prime-respaldo-AAAA-MM-DD.json`. En la pantalla de bienvenida también está el botón **Importar respaldo**.
2. Se cargan tus días (checks, gym, rutina, running, plan B, comida libre), los pesos, la fecha de guardia y tus números (2250 kcal · P 175 · C 240 · G 65, meta 80 kg). Los podés cambiar en Perfil.
3. Desde ese momento todo queda en tu cuenta: entrás desde el iPhone o la Mac y ves lo mismo.

### 7. Face ID / Touch ID

1. Entrá una vez con tu email y contraseña en cada dispositivo. En el iPhone, hacelo **dentro de la app instalada**, porque tiene su propio almacenamiento, separado de Safari. Cuando iOS ofrezca guardar la contraseña en el Llavero, aceptá: así también se completa sola con Face ID.
2. **Perfil → Cuenta y datos → "Pedir Face ID / Touch ID al abrir la app"**.
3. Desde ahí la app se abre con tu cara o tu huella, y vuelve a pedirla si estuvo más de 5 minutos en segundo plano. La sesión de Supabase se renueva sola, así que no tenés que volver a escribir la contraseña.

> El bloqueo biométrico protege el acceso a la app en ese dispositivo. La seguridad de los datos la da tu cuenta de Supabase.

> Si ya habías corrido `schema.sql` antes, volvé a correrlo: agrega la columna `data` a la tabla `days` sin borrar nada.

## Probar en la compu sin configurar nada

Si `config.js` queda vacío, la app funciona en **modo local** (sin login, con los datos guardados en ese navegador):

```bash
cd prime-app && python3 -m http.server 5173
```

Después abrí http://localhost:5173. Para pasar datos del modo local a tu cuenta usá **Perfil → Exportar backup** y después **Importar** ya logueado.

## Actualizar la app

Editá los archivos y volvelos a subir a GitHub. Si cambiás archivos, subí también el número de `VERSION` en `sw.js` (por ejemplo `prime-v2`) para que los celulares descarguen la versión nueva.

## Estructura

```
index.html, manifest.webmanifest, sw.js, config.js
css/app.css
js/main.js          app, navegación y hojas
js/store.js         datos: Supabase o localStorage (misma interfaz)
js/nutrition.js     fórmulas de metas, prime y TDEE adaptativo
js/foods-db.js      base propia de alimentos argentinos
js/food-api.js      Open Food Facts, USDA y búsqueda local
js/ai.js            Gemini: foto, texto, recetas y plan
js/planner.js       generador de plan por optimización de macros
js/views/*.js       pantallas
supabase/           schema SQL y Edge Function
```

Los valores nutricionales son estimaciones. Para objetivos médicos, consultá con un profesional.

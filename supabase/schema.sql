-- Prime · esquema de base de datos para Supabase
-- Pegalo completo en Supabase → SQL Editor → New query → Run.
-- Cada tabla tiene Row Level Security: cada usuario solo puede ver y modificar sus propios datos.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  brand text,
  barcode text,
  serving_g double precision,
  serving_label text,
  unit boolean not null default false,
  kcal double precision not null default 0,
  protein double precision not null default 0,
  carbs double precision not null default 0,
  fat double precision not null default 0,
  fiber double precision not null default 0,
  source text not null default 'custom',
  favorite boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists foods_user_barcode on public.foods (user_id, barcode);

create table if not exists public.diary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  meal text not null,
  name text not null,
  grams double precision not null,
  kcal double precision not null default 0,
  protein double precision not null default 0,
  carbs double precision not null default 0,
  fat double precision not null default 0,
  fiber double precision not null default 0,
  food jsonb,
  created_at timestamptz not null default now()
);
create index if not exists diary_user_date on public.diary (user_id, date);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  servings double precision not null default 1,
  total_g double precision,
  items jsonb not null default '[]',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  kg double precision not null,
  bodyfat double precision,
  waist double precision,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create table if not exists public.days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  water_ml integer not null default 0,
  data jsonb not null default '{}',   -- checklist del día: {c:{...}, gym, rut, run, planb, libre}
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
-- Si ya habías corrido una versión anterior de este archivo:
alter table public.days add column if not exists data jsonb not null default '{}';

-- Seguridad: cada usuario solo accede a sus filas
alter table public.profiles enable row level security;
alter table public.foods enable row level security;
alter table public.diary enable row level security;
alter table public.recipes enable row level security;
alter table public.weights enable row level security;
alter table public.plans enable row level security;
alter table public.days enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "own rows" on public.foods;
create policy "own rows" on public.foods for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own rows" on public.diary;
create policy "own rows" on public.diary for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own rows" on public.recipes;
create policy "own rows" on public.recipes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own rows" on public.weights;
create policy "own rows" on public.weights for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own rows" on public.plans;
create policy "own rows" on public.plans for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own rows" on public.days;
create policy "own rows" on public.days for all using (user_id = auth.uid()) with check (user_id = auth.uid());

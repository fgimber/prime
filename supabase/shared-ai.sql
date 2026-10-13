-- IA compartida: los invitados usan la key de Gemini del dueño, con límite diario por persona.
-- La key NO está acá: se guarda como secreto GEMINI_API_KEY en Edge Functions → Secrets.

create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security; -- sin políticas: los usuarios no la pueden leer

create table if not exists public.app_members (
  user_id uuid primary key references auth.users on delete cascade,
  joined_at timestamptz not null default now()
);
alter table public.app_members enable row level security;
drop policy if exists "see own membership" on public.app_members;
create policy "see own membership" on public.app_members for select using (user_id = auth.uid());

create table if not exists public.ai_usage (
  user_id uuid references auth.users on delete cascade,
  day date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "see own usage" on public.ai_usage;
create policy "see own usage" on public.ai_usage for select using (user_id = auth.uid());

-- Código de invitación y límite diario (se cambian editando estos valores)
insert into public.app_config (key, value) values ('invite_code', 'PRIME2026'), ('ai_daily_limit', '40')
  on conflict (key) do nothing;
-- Las cuentas que ya existen (la del dueño) quedan como miembros
insert into public.app_members (user_id) select id from auth.users on conflict do nothing;

create or replace function public.redeem_invite(code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED'; end if;
  if upper(trim(code)) <> upper((select value from app_config where key = 'invite_code')) then return false; end if;
  insert into app_members (user_id) values (auth.uid()) on conflict do nothing;
  return true;
end $$;

create or replace function public.ai_status() returns json
language sql security definer set search_path = public as $$
  select json_build_object(
    'member', exists (select 1 from app_members where user_id = auth.uid()),
    'used', coalesce((select count from ai_usage where user_id = auth.uid() and day = (now() at time zone 'America/Argentina/Buenos_Aires')::date), 0),
    'limit', (select value::int from app_config where key = 'ai_daily_limit'));
$$;

create or replace function public.ai_consume() returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; lim int; n int;
begin
  if auth.uid() is null or not exists (select 1 from app_members where user_id = auth.uid()) then raise exception 'NOT_MEMBER'; end if;
  select value::int into lim from app_config where key = 'ai_daily_limit';
  insert into ai_usage (user_id, day, count) values (auth.uid(), d, 1)
    on conflict (user_id, day) do update set count = ai_usage.count + 1
    returning count into n;
  if n > lim then raise exception 'USER_LIMIT'; end if; -- el error deshace el +1
  return lim - n;
end $$;

create or replace function public.ai_refund() returns void
language sql security definer set search_path = public as $$
  update ai_usage set count = greatest(0, count - 1)
  where user_id = auth.uid() and day = (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

-- Sky Fling cloud saves. Paste this whole file into Supabase -> SQL Editor -> New query -> Run.
-- Saves are keyed by a 6-character sync code. The table itself is locked (row level security with
-- no policies), so nobody can list or browse saves; the game can only read or write one save at a
-- time, and only if it knows that save's code.

create table if not exists public.saves (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;
revoke all on table public.saves from anon, authenticated;

create or replace function public.get_save(p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select data from public.saves where code = upper(p_code);
$$;

create or replace function public.put_save(p_code text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if upper(p_code) !~ '^[A-Z0-9]{6}$' then raise exception 'bad code'; end if;
  if octet_length(p_data::text) > 200000 then raise exception 'save too large'; end if;
  insert into public.saves (code, data, updated_at)
  values (upper(p_code), p_data, now())
  on conflict (code) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke all on function public.get_save(text) from public;
revoke all on function public.put_save(text, jsonb) from public;
grant execute on function public.get_save(text) to anon, authenticated;
grant execute on function public.put_save(text, jsonb) to anon, authenticated;

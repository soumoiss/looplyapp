-- Primeira estrutura do Looply V2. Nenhuma conta ou dado legado é importado.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table private.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null
);

alter table private.admin_users enable row level security;
revoke all on table private.admin_users from public, anon, authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from private.admin_users as administrators
      where administrators.user_id = (select auth.uid())
    );
$function$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null,
  bio text not null default '',
  profile_visibility text not null default 'members'
    check (profile_visibility in ('private', 'members', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format
    check (username = lower(username) and username ~ '^[a-z0-9_]{3,30}$'),
  constraint profiles_display_name_length
    check (char_length(display_name) between 1 and 80),
  constraint profiles_bio_length
    check (char_length(bio) <= 280)
);

create unique index profiles_username_lower_uidx
  on public.profiles (lower(username));

comment on table public.profiles is
  'Dados de perfil novos. Não contém e-mail, credenciais nem papel administrativo.';

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  requested_username text;
  requested_display_name text;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  requested_display_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  if requested_username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Username must contain 3-30 lowercase letters, digits, or underscores';
  end if;

  if char_length(requested_display_name) = 0 then
    requested_display_name := requested_username;
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, requested_username, left(requested_display_name, 80));

  -- User metadata is accepted only as profile input. It never grants privileges.
  return new;
end;
$function$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select (id, username, display_name, bio, profile_visibility)
  on table public.profiles to anon, authenticated;
grant update (username, display_name, bio, profile_visibility)
  on table public.profiles to authenticated;

create policy profiles_public_read
on public.profiles
for select
to anon
using (profile_visibility = 'public');

create policy profiles_select_visible
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or profile_visibility in ('members', 'public')
);

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));


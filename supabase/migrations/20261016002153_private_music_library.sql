-- Biblioteca musical pessoal; somente o dono e o fluxo administrativo auditado podem ler.

create table public.music_library (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  title text not null,
  artist text not null default '',
  listen_url text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint music_library_title_length check (char_length(btrim(title)) between 1 and 160),
  constraint music_library_artist_length check (char_length(artist) <= 120),
  constraint music_library_note_length check (char_length(note) <= 1000),
  constraint music_library_url_allowed check (
    char_length(listen_url) <= 1000
    and listen_url ~ '^https://(open\.spotify\.com|music\.youtube\.com|youtu\.be|www\.youtube\.com|youtube\.com|music\.apple\.com|soundcloud\.com)/'
  )
);

create index music_library_owner_created_idx on public.music_library (owner_id, created_at desc);
create trigger music_library_touch_updated_at
before update on public.music_library
for each row execute function private.touch_updated_at();

alter table public.music_library enable row level security;
revoke all on table public.music_library from public, anon, authenticated;
grant select, insert, update, delete on table public.music_library to authenticated;

create policy music_library_select_owner
on public.music_library for select to authenticated
using (owner_id = (select auth.uid()));

create policy music_library_insert_owner
on public.music_library for insert to authenticated
with check (owner_id = (select auth.uid()));

create policy music_library_update_owner
on public.music_library for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy music_library_delete_owner
on public.music_library for delete to authenticated
using (owner_id = (select auth.uid()));

alter table private.admin_audit drop constraint admin_audit_resource_type_check;
alter table private.admin_audit add constraint admin_audit_resource_type_check
  check (resource_type in (
    'posts', 'music_dedications', 'music_library', 'profiles', 'post_media', 'music_comments',
    'conversations', 'letters', 'chat_messages', 'chat_media', 'audit'
  ));

create or replace function public.record_looply_admin_access(
  p_actor_id uuid,
  p_event text,
  p_resource_type text,
  p_resource_id uuid,
  p_purpose text,
  p_request_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  audit_id uuid;
begin
  if p_actor_id is null
     or p_event not in (
       'access_denied', 'read_requested', 'read_completed', 'read_failed',
       'write_requested', 'write_completed', 'write_failed'
     )
     or p_resource_type not in (
       'posts', 'music_dedications', 'music_library', 'profiles', 'post_media', 'music_comments',
       'conversations', 'letters', 'chat_messages', 'chat_media', 'audit'
     )
     or p_purpose is null or char_length(btrim(p_purpose)) not between 20 and 500
     or p_request_id is null then
    raise exception 'Invalid administrative audit event' using errcode = '22023';
  end if;

  if p_event <> 'access_denied' and not exists (
    select 1 from private.admin_users as administrator
    where administrator.user_id = p_actor_id
  ) then
    raise exception 'Administrator membership required' using errcode = '42501';
  end if;

  insert into private.admin_audit (actor_id, event, resource_type, resource_id, purpose, request_id, metadata)
  values (p_actor_id, p_event, p_resource_type, p_resource_id, btrim(p_purpose), p_request_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into audit_id;

  return audit_id;
end;
$function$;

revoke all on function public.record_looply_admin_access(uuid, text, text, uuid, text, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_looply_admin_access(uuid, text, text, uuid, text, uuid, jsonb)
  to service_role;

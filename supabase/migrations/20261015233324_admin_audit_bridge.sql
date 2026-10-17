-- Audit administrativo interno; somente a Edge Function usa os RPCs privilegiados.

create table private.admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  event text not null check (event in ('access_denied', 'read_requested', 'read_completed', 'read_failed')),
  resource_type text not null check (resource_type in (
    'posts', 'music_dedications', 'profiles', 'post_media', 'music_comments', 'conversations', 'letters', 'chat_messages', 'audit'
  )),
  resource_id uuid,
  purpose text not null check (char_length(btrim(purpose)) between 20 and 500),
  request_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_actor_created_idx on private.admin_audit (actor_id, created_at desc);
create index admin_audit_resource_created_idx on private.admin_audit (resource_type, resource_id, created_at desc);
alter table private.admin_audit enable row level security;
revoke all on table private.admin_audit from public, anon, authenticated, service_role;

create or replace function public.is_looply_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null and exists (
    select 1 from private.admin_users as administrator
    where administrator.user_id = p_user_id
  );
$function$;

revoke all on function public.is_looply_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_looply_admin(uuid) to service_role;

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
     or p_event not in ('access_denied', 'read_requested', 'read_completed', 'read_failed')
     or p_resource_type not in ('posts', 'music_dedications', 'profiles', 'post_media', 'music_comments', 'conversations', 'letters', 'chat_messages', 'audit')
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

create or replace function public.read_looply_admin_audit(p_actor_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if p_actor_id is null or not exists (
    select 1 from private.admin_users as administrator
    where administrator.user_id = p_actor_id
  ) then
    raise exception 'Administrator membership required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(entries) order by entries.created_at desc), '[]'::jsonb)
    into result
  from (
    select id, actor_id, event, resource_type, resource_id, purpose, request_id, metadata, created_at
    from private.admin_audit
    order by created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) as entries;

  return result;
end;
$function$;

revoke all on function public.read_looply_admin_audit(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.read_looply_admin_audit(uuid, integer) to service_role;

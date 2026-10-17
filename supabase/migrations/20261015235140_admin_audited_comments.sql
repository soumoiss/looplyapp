-- Adiciona eventos de escrita auditada para comentarios administrativos.

alter table private.admin_audit drop constraint admin_audit_event_check;
alter table private.admin_audit add constraint admin_audit_event_check
  check (event in (
    'access_denied', 'read_requested', 'read_completed', 'read_failed',
    'write_requested', 'write_completed', 'write_failed'
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
       'posts', 'music_dedications', 'profiles', 'post_media', 'music_comments',
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

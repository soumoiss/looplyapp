-- Folder names never decide who can see a new media item. New imports are public,
-- and an administrator assigns exclusivity later from the audited gallery control.
-- Reimporting a path refreshes its metadata while preserving its current audience.
create or replace function public.import_looply_archive_media(
  p_actor_id uuid,
  p_purpose text,
  p_request_id uuid,
  p_item jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_value text := p_item->>'source_path';
  file_name_value text := p_item->>'file_name';
  storage_value text := p_item->>'storage_path';
  visibility_value text := p_item->>'visibility';
  description_value text := coalesce(p_item->>'description', '');
  inserted_media_id uuid;
  expected_mime text;
  expected_kind text;
begin
  if p_actor_id is null or p_purpose is null or char_length(btrim(p_purpose)) not between 20 and 500
     or p_request_id is null or p_item is null or jsonb_typeof(p_item) is distinct from 'object'
     or not exists (select 1 from private.admin_users a where a.user_id = p_actor_id) then
    raise exception 'Invalid or unauthorized archive media import' using errcode = '42501';
  end if;
  if source_value is null or source_value !~* '^midia/([^/]+|misol/[^/]+|yara/[^/]+)$'
      or file_name_value is null or file_name_value <> regexp_replace(source_value, '^.*/', '')
     or storage_value is distinct from ('legacy-archive/' || source_value)
     or visibility_value is distinct from 'members'
     or char_length(description_value) > 10000 then
    raise exception 'Invalid archive source path, audience, or description' using errcode = '22023';
  end if;
  if p_item ? 'recipient_ids' and jsonb_typeof(p_item->'recipient_ids') is distinct from 'array' then
    raise exception 'Invalid archive media recipients' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_item->'recipient_ids', '[]'::jsonb)) <> 0 then
    raise exception 'New archive media imports cannot assign recipients; use the audited gallery audience control' using errcode = '22023';
  end if;

  expected_mime := case lower(substring(file_name_value from '\.([^.]+)$'))
    when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png' when 'webp' then 'image/webp'
    when 'heic' then 'image/heic' when 'mp4' then 'video/mp4'
    when 'webm' then 'video/webm' when 'mp3' then 'audio/mpeg'
    else null
  end;
  expected_kind := case
    when expected_mime like 'image/%' then 'image'
    when expected_mime like 'video/%' then 'video'
    when expected_mime like 'audio/%' then 'audio'
    else null
  end;
  if expected_mime is null or p_item->>'mime_type' is distinct from expected_mime
     or p_item->>'kind' is distinct from expected_kind then
    raise exception 'Archive media extension, type and MIME do not match' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.buckets bucket where bucket.id = 'looply-media' and not bucket.public) then
    raise exception 'Private media bucket is unavailable' using errcode = '55000';
  end if;

  insert into private.admin_audit (actor_id, event, resource_type, purpose, request_id, metadata)
  values (p_actor_id, 'write_requested', 'archive_media', btrim(p_purpose), p_request_id,
    jsonb_build_object('source_path', source_value));

  insert into public.archive_media (
    source_path, file_name, description, storage_path, kind, mime_type,
    byte_size, visibility, source_date
  )
  values (
    source_value, file_name_value, description_value, storage_value, p_item->>'kind', p_item->>'mime_type',
    (p_item->>'byte_size')::bigint, 'members', nullif(p_item->>'source_date', '')::timestamptz
  )
  on conflict (source_path) do update set
    file_name = excluded.file_name,
    description = excluded.description,
    storage_path = excluded.storage_path,
    kind = excluded.kind,
    mime_type = excluded.mime_type,
    byte_size = excluded.byte_size,
    source_date = excluded.source_date,
    updated_at = now()
  returning id into inserted_media_id;

  insert into private.admin_audit (actor_id, event, resource_type, resource_id, purpose, request_id, metadata)
  values (p_actor_id, 'write_completed', 'archive_media', inserted_media_id, btrim(p_purpose), p_request_id,
    jsonb_build_object('source_path', source_value, 'byte_size', (p_item->>'byte_size')::bigint));
  return inserted_media_id;
end;
$function$;
revoke all on function public.import_looply_archive_media(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_looply_archive_media(uuid, text, uuid, jsonb)
  to service_role;


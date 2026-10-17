-- Restored legacy cards and media. Personal contents stay in Supabase, never in Git.

create table public.archived_cards (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  original_file text not null check (original_file ~* '^(misol|patati|yara)carta(privada)?[0-9]+\.txt$'),
  card_number integer not null check (card_number between 1 and 999),
  is_private boolean not null default false,
  is_protected boolean not null default false,
  password_hint text not null default '' check (char_length(password_hint) <= 300),
  body text,
  sent_date date,
  imported_at timestamptz not null default now(),
  constraint archived_cards_body_protection_check check (
    (is_protected and body is null) or (not is_protected and body is not null)
  ),
  constraint archived_cards_identity_check check (
    (is_private and original_file ~* 'cartaPrivada[0-9]+\.txt$')
    or (not is_private and original_file !~* 'cartaPrivada[0-9]+\.txt$')
  ),
  constraint archived_cards_recipient_file_key unique (recipient_id, original_file)
);

create index archived_cards_recipient_number_idx
  on public.archived_cards (recipient_id, is_private desc, card_number, original_file);
alter table public.archived_cards enable row level security;
revoke all on table public.archived_cards from public, anon;
grant select on table public.archived_cards to authenticated;

create policy archived_cards_recipient_read
on public.archived_cards for select to authenticated
using (recipient_id = (select auth.uid()));

create table public.archived_card_reads (
  card_id uuid not null references public.archived_cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (card_id, user_id)
);
create index archived_card_reads_user_idx on public.archived_card_reads (user_id, read_at desc);
alter table public.archived_card_reads enable row level security;
revoke all on table public.archived_card_reads from public, anon;
grant select, insert, update on table public.archived_card_reads to authenticated;

create policy archived_card_reads_owner_select
on public.archived_card_reads for select to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.archived_cards card
  where card.id = card_id and card.recipient_id = (select auth.uid())
));
create policy archived_card_reads_owner_insert
on public.archived_card_reads for insert to authenticated
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.archived_cards card
  where card.id = card_id and card.recipient_id = (select auth.uid())
));
create policy archived_card_reads_owner_update
on public.archived_card_reads for update to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.archived_cards card
  where card.id = card_id and card.recipient_id = (select auth.uid())
))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.archived_cards card
  where card.id = card_id and card.recipient_id = (select auth.uid())
));

create table private.archived_card_secrets (
  card_id uuid primary key references public.archived_cards (id) on delete cascade,
  body text not null,
  password_salt text not null,
  password_hash text not null,
  password_hint text not null default ''
);
alter table private.archived_card_secrets enable row level security;
revoke all on table private.archived_card_secrets from public, anon, authenticated, service_role;

create table private.archived_card_unlock_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null references public.archived_cards (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 8),
  locked_until timestamptz,
  primary key (user_id, card_id)
);
alter table private.archived_card_unlock_attempts enable row level security;
revoke all on table private.archived_card_unlock_attempts from public, anon, authenticated, service_role;

create table public.archive_media (
  id uuid primary key default gen_random_uuid(),
  source_path text not null unique check (source_path ~* '^midia/([^/]+|misol/[^/]+|yara/[^/]+)$'),
  file_name text not null check (char_length(file_name) between 1 and 255),
  storage_path text not null unique check (storage_path like 'legacy-archive/midia/%'),
  kind text not null check (kind in ('image', 'video', 'audio')),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'video/mp4', 'video/webm', 'audio/mpeg'
  )),
  byte_size bigint not null check (byte_size between 1 and 104857600),
  visibility text not null check (visibility in ('members', 'exclusive')),
  source_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index archive_media_visibility_created_idx on public.archive_media (visibility, created_at desc);
alter table public.archive_media enable row level security;
revoke all on table public.archive_media from public, anon;
grant select on table public.archive_media to authenticated;

create table public.archive_media_recipients (
  media_id uuid not null references public.archive_media (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (media_id, user_id)
);
create index archive_media_recipients_user_idx on public.archive_media_recipients (user_id, media_id);
alter table public.archive_media_recipients enable row level security;
revoke all on table public.archive_media_recipients from public, anon;
grant select on table public.archive_media_recipients to authenticated;

create or replace function private.can_view_archive_media(p_media_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.archive_media media
    where media.id = p_media_id
      and (
        media.visibility = 'members'
        or exists (
          select 1 from public.archive_media_recipients recipient
          where recipient.media_id = media.id and recipient.user_id = (select auth.uid())
        )
      )
  );
$function$;
revoke all on function private.can_view_archive_media(uuid) from public, anon;
grant execute on function private.can_view_archive_media(uuid) to authenticated, service_role;

create policy archive_media_audience_read
on public.archive_media for select to authenticated
using ((select private.can_view_archive_media(id)));
create policy archive_media_recipients_owner_read
on public.archive_media_recipients for select to authenticated
using (user_id = (select auth.uid()) and (select private.can_view_archive_media(media_id)));

create table public.archive_media_comments (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.archive_media (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index archive_media_comments_media_created_idx on public.archive_media_comments (media_id, created_at);
create index archive_media_comments_author_idx on public.archive_media_comments (author_id, created_at desc);
alter table public.archive_media_comments enable row level security;
revoke all on table public.archive_media_comments from public, anon;
grant select, insert, update, delete on table public.archive_media_comments to authenticated;

create policy archive_media_comments_audience_read
on public.archive_media_comments for select to authenticated
using ((select private.can_view_archive_media(media_id)));
create policy archive_media_comments_author_insert
on public.archive_media_comments for insert to authenticated
with check (author_id = (select auth.uid()) and (select private.can_view_archive_media(media_id)));
create policy archive_media_comments_author_update
on public.archive_media_comments for update to authenticated
using (author_id = (select auth.uid()) and (select private.can_view_archive_media(media_id)))
with check (author_id = (select auth.uid()) and (select private.can_view_archive_media(media_id)));
create policy archive_media_comments_author_delete
on public.archive_media_comments for delete to authenticated
using (author_id = (select auth.uid()) and (select private.can_view_archive_media(media_id)));

create policy looply_legacy_archive_media_read
on storage.objects for select to authenticated
using (
  bucket_id = 'looply-media'
  and (select private.can_view_archive_media((
    select media.id from public.archive_media media where media.storage_path = storage.objects.name limit 1
  )))
);
create policy looply_legacy_archive_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'looply-media'
  and (storage.foldername(name))[1] = 'legacy-archive'
  and (select private.is_admin())
);
create policy looply_legacy_archive_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'looply-media'
  and (storage.foldername(name))[1] = 'legacy-archive'
  and (select private.is_admin())
);

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'video/mp4', 'video/webm', 'audio/mpeg'
]::text[]
where id = 'looply-media';

alter table private.admin_audit drop constraint admin_audit_resource_type_check;
alter table private.admin_audit add constraint admin_audit_resource_type_check
  check (resource_type in (
    'posts', 'music_dedications', 'music_library', 'profiles', 'post_media', 'music_comments',
    'conversations', 'letters', 'chat_messages', 'chat_media', 'archive_media',
    'archive_media_comments', 'archived_cards', 'audit'
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
       'conversations', 'letters', 'chat_messages', 'chat_media', 'archive_media',
       'archive_media_comments', 'archived_cards', 'audit'
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

create or replace function public.import_looply_archived_cards(
  p_actor_id uuid,
  p_purpose text,
  p_request_id uuid,
  p_cards jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  entry jsonb;
  target_id uuid;
  target_name text;
  new_card_id uuid;
  imported integer := 0;
  file_name text;
  number_value integer;
  private_value boolean;
  protected_value boolean;
  body_value text;
begin
  if p_actor_id is null or p_purpose is null or char_length(btrim(p_purpose)) not between 20 and 500
     or p_request_id is null or p_cards is null then
    raise exception 'Invalid archive card import batch' using errcode = '22023';
  end if;
  if jsonb_typeof(p_cards) is distinct from 'array'
     or jsonb_array_length(p_cards) not between 1 and 25 then
    raise exception 'Invalid archive card import batch' using errcode = '22023';
  end if;
  if not exists (select 1 from private.admin_users a where a.user_id = p_actor_id) then
    raise exception 'Administrator membership required' using errcode = '42501';
  end if;

  insert into private.admin_audit (actor_id, event, resource_type, purpose, request_id, metadata)
  values (p_actor_id, 'write_requested', 'archived_cards', btrim(p_purpose), p_request_id,
    jsonb_build_object('batch_count', jsonb_array_length(p_cards)));

  for entry in select value from jsonb_array_elements(p_cards) loop
    file_name := entry->>'original_file';
    if file_name !~* '^(misol|patati|yara)carta(privada)?[0-9]+\.txt$' then
      raise exception 'Unsupported legacy card filename' using errcode = '22023';
    end if;
    target_name := lower((regexp_match(file_name, '^(misol|patati|yara)', 'i'))[1]);
    select profile.id into target_id from public.profiles profile where profile.username = target_name;
    if target_id is null or target_id <> (entry->>'recipient_id')::uuid then
      raise exception 'Card recipient does not match its confirmed username' using errcode = '22023';
    end if;
    number_value := ((regexp_match(file_name, '([0-9]+)\.txt$', 'i'))[1])::integer;
    private_value := file_name ~* 'cartaprivada[0-9]+\.txt$';
    protected_value := coalesce((entry->>'is_protected')::boolean, false) or private_value;
    body_value := case when protected_value then null else entry->>'body' end;
    if protected_value and (
      coalesce(entry->>'secret_body', '') = ''
      or coalesce(entry->>'password_salt', '') = ''
      or coalesce(entry->>'password_hash', '') = ''
    ) then
      raise exception 'Protected cards require a server-verified password hash' using errcode = '22023';
    end if;
    if not protected_value and (body_value is null or char_length(body_value) > 100000) then
      raise exception 'Card body is empty or too long' using errcode = '22023';
    end if;

    insert into public.archived_cards (recipient_id, original_file, card_number, is_private, is_protected, password_hint, body, sent_date)
    values (
      target_id, file_name, number_value, private_value, protected_value, coalesce(entry->>'password_hint', ''), body_value,
      nullif(entry->>'sent_date', '')::date
    )
    on conflict (recipient_id, original_file) do update set
      card_number = excluded.card_number,
      is_private = excluded.is_private,
      is_protected = excluded.is_protected,
      password_hint = excluded.password_hint,
      body = excluded.body,
      sent_date = excluded.sent_date,
      imported_at = now()
    returning id into new_card_id;

    if protected_value then
      insert into private.archived_card_secrets (card_id, body, password_salt, password_hash, password_hint)
      values (new_card_id, entry->>'secret_body', entry->>'password_salt', entry->>'password_hash', coalesce(entry->>'password_hint', ''))
      on conflict (card_id) do update set
        body = excluded.body,
        password_salt = excluded.password_salt,
        password_hash = excluded.password_hash,
        password_hint = excluded.password_hint;
    else
      delete from private.archived_card_secrets where card_id = new_card_id;
    end if;
    imported := imported + 1;
  end loop;

  insert into private.admin_audit (actor_id, event, resource_type, purpose, request_id, metadata)
  values (p_actor_id, 'write_completed', 'archived_cards', btrim(p_purpose), p_request_id,
    jsonb_build_object('imported_count', imported));
  return imported;
end;
$function$;
revoke all on function public.import_looply_archived_cards(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_looply_archived_cards(uuid, text, uuid, jsonb) to service_role;

create or replace function public.read_looply_admin_archived_cards(p_actor_id uuid, p_card_id uuid default null, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if p_actor_id is null or not exists (select 1 from private.admin_users a where a.user_id = p_actor_id) then
    raise exception 'Administrator membership required' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Invalid card limit' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(card) || jsonb_build_object(
    'body', case when card.is_protected then secret.body else card.body end,
    'password_hint', case when card.is_protected then secret.password_hint else null end
  ) order by card.recipient_id, card.is_private desc, card.card_number), '[]'::jsonb)
  into result
  from (
    select cards.* from public.archived_cards cards
    where p_card_id is null or cards.id = p_card_id
    order by cards.imported_at desc limit p_limit
  ) card
  left join private.archived_card_secrets secret on secret.card_id = card.id;
  return result;
end;
$function$;
revoke all on function public.read_looply_admin_archived_cards(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.read_looply_admin_archived_cards(uuid, uuid, integer) to service_role;

create or replace function public.read_looply_archived_card_secret(p_actor_id uuid, p_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if p_actor_id is null or p_card_id is null then raise exception 'Card and user are required' using errcode = '22023'; end if;
  select jsonb_build_object(
    'body', secret.body,
    'password_salt', secret.password_salt,
    'password_hash', secret.password_hash,
    'password_hint', secret.password_hint
  ) into result
  from public.archived_cards card
  join private.archived_card_secrets secret on secret.card_id = card.id
  where card.id = p_card_id and card.recipient_id = p_actor_id and card.is_protected;
  if result is null then raise exception 'Protected card is unavailable' using errcode = '42501'; end if;
  return result;
end;
$function$;
revoke all on function public.read_looply_archived_card_secret(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_looply_archived_card_secret(uuid, uuid) to service_role;

create or replace function public.consume_looply_archived_card_unlock(p_actor_id uuid, p_card_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt_row private.archived_card_unlock_attempts%rowtype;
begin
  if p_actor_id is null or p_card_id is null or not exists (
    select 1 from public.archived_cards card
    where card.id = p_card_id and card.recipient_id = p_actor_id and card.is_protected
  ) then
    raise exception 'Protected card is unavailable' using errcode = '42501';
  end if;

  insert into private.archived_card_unlock_attempts (user_id, card_id)
  values (p_actor_id, p_card_id) on conflict (user_id, card_id) do nothing;
  select * into attempt_row from private.archived_card_unlock_attempts
    where user_id = p_actor_id and card_id = p_card_id for update;

  if attempt_row.locked_until is not null and attempt_row.locked_until > now() then
    return false;
  end if;
  if attempt_row.window_started_at < now() - interval '15 minutes' then
    update private.archived_card_unlock_attempts set window_started_at = now(), attempts = 1, locked_until = null
      where user_id = p_actor_id and card_id = p_card_id;
    return true;
  end if;
  if attempt_row.attempts >= 8 then
    update private.archived_card_unlock_attempts set locked_until = now() + interval '15 minutes'
      where user_id = p_actor_id and card_id = p_card_id;
    return false;
  end if;
  update private.archived_card_unlock_attempts set attempts = attempts + 1
    where user_id = p_actor_id and card_id = p_card_id;
  return true;
end;
$function$;
revoke all on function public.consume_looply_archived_card_unlock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_looply_archived_card_unlock(uuid, uuid) to service_role;

create or replace function public.reset_looply_archived_card_unlock(p_actor_id uuid, p_card_id uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  delete from private.archived_card_unlock_attempts
  where user_id = p_actor_id and card_id = p_card_id;
$function$;
revoke all on function public.reset_looply_archived_card_unlock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reset_looply_archived_card_unlock(uuid, uuid) to service_role;

create or replace function public.import_looply_archive_media(p_actor_id uuid, p_purpose text, p_request_id uuid, p_item jsonb)
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
  target_id uuid;
  recipient_id uuid;
  inserted_media_id uuid;
  expected_name text;
  recipient_name text;
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
     or storage_value <> ('legacy-archive/' || source_value)
     or visibility_value not in ('members', 'exclusive') then
    raise exception 'Invalid archive source path or visibility' using errcode = '22023';
  end if;
  if p_item ? 'recipient_ids' and jsonb_typeof(p_item->'recipient_ids') is distinct from 'array' then
    raise exception 'Invalid archive media recipients' using errcode = '22023';
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
  if visibility_value = 'exclusive' then
    expected_name := case
      when source_value ~* '^midia/misol/' then 'misol'
      when source_value ~* '^midia/yara/' then 'yara'
      else null
    end;
    if expected_name is null then
      raise exception 'Exclusive archive files require an authorized owner folder' using errcode = '22023';
    end if;
    if jsonb_typeof(p_item->'recipient_ids') <> 'array'
       or jsonb_array_length(p_item->'recipient_ids') <> 1 then
      raise exception 'Exclusive archive files require exactly one known recipient' using errcode = '22023';
    end if;
    recipient_id := (p_item->'recipient_ids'->>0)::uuid;
    select profile.id, profile.username into target_id, recipient_name
      from public.profiles profile where profile.id = recipient_id;
    if target_id is null or expected_name is distinct from recipient_name then
      raise exception 'Exclusive archive recipient is not in the authorized audience' using errcode = '22023';
    end if;
  else
    if source_value ~* '^midia/(misol|yara)/' then
      raise exception 'Owner-folder archive files must stay exclusive' using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(p_item->'recipient_ids', '[]'::jsonb)) <> 0 then
      raise exception 'Shared archive files cannot have exclusive recipients' using errcode = '22023';
    end if;
  end if;
  if not exists (select 1 from storage.buckets bucket where bucket.id = 'looply-media' and not bucket.public) then
    raise exception 'Private media bucket is unavailable' using errcode = '55000';
  end if;

  insert into private.admin_audit (actor_id, event, resource_type, purpose, request_id, metadata)
  values (p_actor_id, 'write_requested', 'archive_media', btrim(p_purpose), p_request_id,
    jsonb_build_object('source_path', source_value));

  insert into public.archive_media (source_path, file_name, storage_path, kind, mime_type, byte_size, visibility, source_date)
  values (
    source_value, file_name_value, storage_value, p_item->>'kind', p_item->>'mime_type',
    (p_item->>'byte_size')::bigint, visibility_value, nullif(p_item->>'source_date', '')::timestamptz
  )
  on conflict (source_path) do update set
    file_name = excluded.file_name, storage_path = excluded.storage_path,
    kind = excluded.kind, mime_type = excluded.mime_type, byte_size = excluded.byte_size,
    visibility = excluded.visibility, source_date = excluded.source_date, updated_at = now()
  returning id into inserted_media_id;

  delete from public.archive_media_recipients where archive_media_recipients.media_id = inserted_media_id;
  if visibility_value = 'exclusive' then
    insert into public.archive_media_recipients (media_id, user_id) values (inserted_media_id, recipient_id);
  end if;

  insert into private.admin_audit (actor_id, event, resource_type, resource_id, purpose, request_id, metadata)
  values (p_actor_id, 'write_completed', 'archive_media', inserted_media_id, btrim(p_purpose), p_request_id,
    jsonb_build_object('source_path', source_value, 'byte_size', (p_item->>'byte_size')::bigint));
  return inserted_media_id;
end;
$function$;
revoke all on function public.import_looply_archive_media(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_looply_archive_media(uuid, text, uuid, jsonb) to service_role;

alter publication supabase_realtime add table public.archive_media;
alter publication supabase_realtime add table public.archive_media_comments;


-- Comunidade: cartas selecionadas/protegidas, galeria de membros e recibos de leitura.
-- Cartas protegidas são criptografadas no navegador; nenhuma senha em texto puro é armazenada.
alter table public.archive_media drop constraint archive_media_byte_size_check;
alter table public.archive_media add constraint archive_media_byte_size_check
  check (byte_size between 1 and 209715200);
alter table public.chat_messages
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz;

create or replace function public.mark_conversations_delivered(p_conversation_ids uuid[])
returns void language plpgsql security definer set search_path = ''
as $function$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or coalesce(cardinality(p_conversation_ids), 0) > 50 then
    raise exception 'Invalid conversation list' using errcode = '42501';
  end if;
  update public.chat_messages as message set delivered_at = now()
  where message.conversation_id = any(coalesce(p_conversation_ids, array[]::uuid[]))
    and message.sender_id <> actor_id and message.delivered_at is null
    and exists (select 1 from public.conversation_participants as participant
      where participant.conversation_id = message.conversation_id and participant.user_id = actor_id);
end;
$function$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  latest_incoming timestamptz;
begin
  if actor_id is null or not private.is_conversation_participant(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  update public.chat_messages as message
  set delivered_at = coalesce(message.delivered_at, now()), read_at = coalesce(message.read_at, now())
  where message.conversation_id = p_conversation_id and message.sender_id <> actor_id
    and (message.delivered_at is null or message.read_at is null);
  select max(message.created_at) into latest_incoming from public.chat_messages as message
  where message.conversation_id = p_conversation_id and message.sender_id <> actor_id;
  if latest_incoming is not null then
    update public.conversation_participants as participant
    set last_read_at = greatest(participant.last_read_at, latest_incoming)
    where participant.conversation_id = p_conversation_id and participant.user_id = actor_id;
  end if;
  update public.chat_notifications as notification set read_at = now()
  where notification.conversation_id = p_conversation_id and notification.user_id = actor_id and notification.read_at is null;
end;
$function$;

revoke all on function public.mark_conversations_delivered(uuid[]) from public, anon, authenticated;
revoke all on function public.mark_conversation_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_conversations_delivered(uuid[]) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

create table public.community_letters (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null,
  body text,
  is_protected boolean not null default false,
  password_salt text,
  password_iv text,
  password_ciphertext text,
  created_at timestamptz not null default now(),
  constraint community_letters_subject_length check (char_length(btrim(subject)) between 1 and 120),
  constraint community_letters_distinct_members check (sender_id <> recipient_id),
  constraint community_letters_content_shape check (
    (is_protected = false and body is not null and char_length(btrim(body)) between 1 and 5000
      and password_salt is null and password_iv is null and password_ciphertext is null)
    or (is_protected = true and body is null
      and password_salt ~ '^[A-Za-z0-9_-]{22}$'
      and password_iv ~ '^[A-Za-z0-9_-]{16}$'
      and password_ciphertext ~ '^[A-Za-z0-9_-]{22,7000}$')
  )
);
create index community_letters_recipient_created_idx on public.community_letters(recipient_id, created_at desc);
create index community_letters_sender_created_idx on public.community_letters(sender_id, created_at desc);
alter table public.community_letters enable row level security;
revoke all on table public.community_letters from public, anon, authenticated;
grant select on table public.community_letters to authenticated;
grant insert (sender_id, recipient_id, subject, body, is_protected, password_salt, password_iv, password_ciphertext)
  on public.community_letters to authenticated;
create policy community_letters_related_read on public.community_letters for select to authenticated
using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()) or (select private.is_admin()));
create policy community_letters_sender_insert on public.community_letters for insert to authenticated
with check (sender_id = (select auth.uid()) and recipient_id <> (select auth.uid()));

create table public.community_gallery_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  kind text not null check (kind in ('image', 'video', 'audio')),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/aac'
  )),
  byte_size bigint not null check (byte_size between 1 and 209715200),
  caption text not null default '',
  created_at timestamptz not null default now(),
  constraint community_gallery_file_name_length check (char_length(file_name) between 1 and 180),
  constraint community_gallery_caption_length check (char_length(caption) <= 500),
  constraint community_gallery_kind_matches_mime check (
    (kind = 'image' and mime_type like 'image/%') or (kind = 'video' and mime_type like 'video/%')
    or (kind = 'audio' and mime_type like 'audio/%')
  ),
  constraint community_gallery_storage_path_matches_owner check (
    storage_path ~ ('^gallery/' || owner_id::text || '/[a-f0-9-]{36}\.(jpg|jpeg|png|webp|heic|mp4|webm|mp3|m4a|ogg|wav|aac)$')
  )
);
create index community_gallery_owner_created_idx on public.community_gallery_media(owner_id, created_at desc);
create index community_gallery_created_idx on public.community_gallery_media(created_at desc);
alter table public.community_gallery_media enable row level security;
revoke all on table public.community_gallery_media from public, anon, authenticated;
grant select on public.community_gallery_media to authenticated;
grant insert (owner_id, storage_path, file_name, kind, mime_type, byte_size, caption) on public.community_gallery_media to authenticated;
grant update (caption) on public.community_gallery_media to authenticated;
grant delete on public.community_gallery_media to authenticated;
create policy community_gallery_members_read on public.community_gallery_media for select to authenticated using (true);
create policy community_gallery_owner_insert on public.community_gallery_media for insert to authenticated
with check (owner_id = (select auth.uid())
  and byte_size <= case when (select private.is_admin()) then 209715200 else 104857600 end);
create policy community_gallery_owner_update on public.community_gallery_media for update to authenticated
using (owner_id = (select auth.uid()) or (select private.is_admin()))
with check (owner_id = (select auth.uid()) or (select private.is_admin()));
create policy community_gallery_owner_delete on public.community_gallery_media for delete to authenticated
using (owner_id = (select auth.uid()) or (select private.is_admin()));

create or replace function private.validate_community_gallery_object()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare object_size bigint;
begin
  select case when coalesce(object.metadata ->> 'size', '') ~ '^[0-9]{1,12}$'
      then (object.metadata ->> 'size')::bigint else null end
  into object_size from storage.objects as object
  where object.bucket_id = 'looply-gallery' and object.name = new.storage_path;
  if object_size is null then raise exception 'Uploaded gallery object is missing or has invalid size' using errcode = '23503'; end if;
  if object_size <> new.byte_size then raise exception 'Gallery object size does not match metadata' using errcode = '23514'; end if;
  if object_size > (case when private.is_admin() then 209715200 else 104857600 end) then
    raise exception 'Gallery upload exceeds the role limit' using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function private.validate_community_gallery_object() from public, anon, authenticated;
create trigger community_gallery_validate_object before insert on public.community_gallery_media
for each row execute function private.validate_community_gallery_object();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('looply-gallery', 'looply-gallery', false, 209715200, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/aac'
]::text[])
on conflict (id) do update set name = excluded.name, public = false,
file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
update storage.buckets set file_size_limit = 209715200 where id = 'looply-media';

create policy looply_gallery_insert_owner on storage.objects for insert to authenticated with check (
  bucket_id = 'looply-gallery' and (storage.foldername(name))[1] = 'gallery'
  and private.try_uuid((storage.foldername(name))[2]) = (select auth.uid())
  and storage.filename(name) ~ '^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|heic|mp4|webm|mp3|m4a|ogg|wav|aac)$'
  and case when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,12}$'
    then (metadata ->> 'size')::bigint between 1 and case when (select private.is_admin()) then 209715200 else 104857600 end
    else false end
);
create policy looply_gallery_read_registered on storage.objects for select to authenticated using (
  bucket_id = 'looply-gallery' and exists (select 1 from public.community_gallery_media as media where media.storage_path = objects.name)
);
create policy looply_gallery_delete_owner on storage.objects for delete to authenticated using (
  bucket_id = 'looply-gallery' and (storage.foldername(name))[1] = 'gallery'
  and (private.try_uuid((storage.foldername(name))[2]) = (select auth.uid()) or (select private.is_admin()))
);

do $publication$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_letters') then
    alter publication supabase_realtime add table public.community_letters;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_gallery_media') then
    alter publication supabase_realtime add table public.community_gallery_media;
  end if;
end;
$publication$;

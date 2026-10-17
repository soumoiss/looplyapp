-- Conversas privadas, cartas ao Peixinho, anexos de chat e notificacoes persistentes.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'letter')),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subject text,
  direct_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_subject_kind check (
    (kind = 'direct' and subject is null and direct_key is not null)
    or (kind = 'letter' and subject is not null and direct_key is null)
  ),
  constraint conversations_subject_length check (subject is null or char_length(btrim(subject)) between 1 and 120)
);

create unique index conversations_direct_key_uidx
  on public.conversations (direct_key) where kind = 'direct';
create index conversations_updated_idx on public.conversations (updated_at desc);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index conversation_participants_user_idx
  on public.conversation_participants (user_id, conversation_id);

create table public.letters (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null,
  created_at timestamptz not null default now(),
  constraint letters_subject_length check (char_length(btrim(subject)) between 1 and 120),
  constraint letters_distinct_participants check (sender_id <> recipient_id)
);

create index letters_sender_created_idx on public.letters (sender_id, created_at desc);
create index letters_recipient_created_idx on public.letters (recipient_id, created_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reply_to uuid,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_messages_body_length check (char_length(btrim(body)) between 1 and 5000),
  constraint chat_messages_id_conversation_unique unique (id, conversation_id),
  constraint chat_messages_reply_same_conversation_fk
    foreign key (reply_to, conversation_id)
    references public.chat_messages (id, conversation_id) on delete set null (reply_to)
);

create index chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at desc);
create index chat_messages_sender_created_idx
  on public.chat_messages (sender_id, created_at desc);

alter table public.letters add column initial_message_id uuid;
alter table public.letters add constraint letters_initial_message_fk
  foreign key (initial_message_id, conversation_id)
  references public.chat_messages (id, conversation_id) on delete set null (initial_message_id);
create unique index letters_initial_message_uidx
  on public.letters (initial_message_id) where initial_message_id is not null;

create table public.chat_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id uuid not null,
  kind text not null check (kind in ('message', 'letter')),
  preview text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint chat_notifications_message_fk
    foreign key (message_id, conversation_id)
    references public.chat_messages (id, conversation_id) on delete cascade,
  constraint chat_notifications_unique_message unique (user_id, message_id),
  constraint chat_notifications_preview_length check (char_length(preview) <= 180)
);

create index chat_notifications_unread_idx
  on public.chat_notifications (user_id, created_at desc) where read_at is null;

create table public.chat_media (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  message_id uuid not null,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm',
    'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'application/pdf', 'text/plain'
  )),
  byte_size bigint not null check (byte_size between 1 and 104857600),
  file_name text not null,
  created_at timestamptz not null default now(),
  constraint chat_media_message_fk
    foreign key (message_id, conversation_id)
    references public.chat_messages (id, conversation_id) on delete cascade,
  constraint chat_media_name_length check (char_length(file_name) between 1 and 180),
  constraint chat_media_path_matches_message check (
    storage_path ~ ('^conversations/' || conversation_id::text || '/' || message_id::text || '/[a-f0-9-]{36}\.(jpg|jpeg|png|webp|mp4|webm|mp3|ogg|pdf|txt)$')
  )
);

create index chat_media_message_created_idx on public.chat_media (conversation_id, message_id, created_at);

create or replace function private.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.conversation_participants as participant
    where participant.conversation_id = p_conversation_id
      and participant.user_id = (select auth.uid())
  );
$function$;

revoke all on function private.is_conversation_participant(uuid) from public, anon, authenticated;
grant execute on function private.is_conversation_participant(uuid) to authenticated;

create or replace function public.create_direct_conversation(p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  new_conversation_id uuid;
  key text;
  target_visibility text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_target_id is null or p_target_id = actor_id then
    raise exception 'Choose another profile' using errcode = '22023';
  end if;

  select profile.profile_visibility into target_visibility
  from public.profiles as profile
  where profile.id = p_target_id;
  if target_visibility is null or (target_visibility = 'private' and not private.is_admin()) then
    raise exception 'Profile is not available' using errcode = '42501';
  end if;

  key := least(actor_id, p_target_id)::text || ':' || greatest(actor_id, p_target_id)::text;
  insert into public.conversations (kind, created_by, direct_key)
  values ('direct', actor_id, key)
  on conflict (direct_key) where kind = 'direct' do nothing
  returning id into new_conversation_id;

  if new_conversation_id is null then
    select conversation.id into new_conversation_id
    from public.conversations as conversation
    where conversation.kind = 'direct' and conversation.direct_key = key;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (new_conversation_id, actor_id), (new_conversation_id, p_target_id)
  on conflict (conversation_id, user_id) do nothing;
  return new_conversation_id;
end;
$function$;

revoke all on function public.create_direct_conversation(uuid) from public, anon, authenticated;
grant execute on function public.create_direct_conversation(uuid) to authenticated;

create or replace function public.create_admin_letter(p_subject text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  admin_id uuid;
  new_conversation_id uuid;
  new_message_id uuid;
  clean_subject text := btrim(coalesce(p_subject, ''));
  clean_body text := btrim(coalesce(p_body, ''));
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(clean_subject) not between 1 and 120
     or char_length(clean_body) not between 1 and 5000 then
    raise exception 'Letter subject or body is invalid' using errcode = '22023';
  end if;

  select administrator.user_id into admin_id
  from private.admin_users as administrator
  join public.profiles as profile on profile.id = administrator.user_id
  where profile.username = 'peixinho'
  order by administrator.granted_at
  limit 1;
  if admin_id is null then
    raise exception 'Peixinho is not yet available as the verified administrator' using errcode = '55000';
  end if;
  if actor_id = admin_id then
    raise exception 'Use a regular conversation to write to yourself' using errcode = '22023';
  end if;

  insert into public.conversations (kind, created_by, subject)
  values ('letter', actor_id, clean_subject)
  returning id into new_conversation_id;
  insert into public.conversation_participants (conversation_id, user_id)
  values (new_conversation_id, actor_id), (new_conversation_id, admin_id);
  insert into public.letters (conversation_id, sender_id, recipient_id, subject)
  values (new_conversation_id, actor_id, admin_id, clean_subject);
  insert into public.chat_messages (conversation_id, sender_id, body)
  values (new_conversation_id, actor_id, clean_body)
  returning id into new_message_id;
  update public.letters as letter set initial_message_id = new_message_id where letter.conversation_id = new_conversation_id;

  return new_conversation_id;
end;
$function$;

revoke all on function public.create_admin_letter(text, text) from public, anon, authenticated;
grant execute on function public.create_admin_letter(text, text) to authenticated;

create or replace function private.touch_conversation_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$function$;

revoke all on function private.touch_conversation_updated_at() from public, anon, authenticated;

create trigger chat_messages_touch_conversation
after insert or update on public.chat_messages
for each row execute function private.touch_conversation_updated_at();

create or replace function private.notify_conversation_participants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  conversation_kind text;
begin
  select conversation.kind into conversation_kind
  from public.conversations as conversation where conversation.id = new.conversation_id;

  insert into public.chat_notifications (user_id, conversation_id, message_id, kind, preview)
  select participant.user_id, new.conversation_id, new.id,
    case when conversation_kind = 'letter' and new.created_at = conversation.created_at then 'letter' else 'message' end,
    left(new.body, 180)
  from public.conversation_participants as participant
  join public.conversations as conversation on conversation.id = participant.conversation_id
  where participant.conversation_id = new.conversation_id
    and participant.user_id <> new.sender_id
  on conflict (user_id, message_id) do nothing;
  return new;
end;
$function$;

revoke all on function private.notify_conversation_participants() from public, anon, authenticated;

create trigger chat_messages_notify_participants
after insert on public.chat_messages
for each row execute function private.notify_conversation_participants();

create or replace function private.validate_chat_media_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  object_exists boolean;
  attachment_count integer;
begin
  if new.created_by is distinct from auth.uid() then
    raise exception 'Attachment owner does not match the active user' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.chat_messages as message
    where message.id = new.message_id
      and message.conversation_id = new.conversation_id
      and message.sender_id = (select auth.uid())
  ) then
    raise exception 'Attachment message is not owned by the active user' using errcode = '42501';
  end if;

  perform 1 from public.conversations as conversation where conversation.id = new.conversation_id for update;
  select count(*)::integer into attachment_count
  from public.chat_media as media where media.message_id = new.message_id;
  if attachment_count >= 8 then
    raise exception 'A message may contain at most 8 attachments' using errcode = '23514';
  end if;

  select exists (
    select 1 from storage.objects as object
    where object.bucket_id = 'looply-chat' and object.name = new.storage_path
  ) into object_exists;
  if not object_exists then
    raise exception 'Uploaded chat object was not found' using errcode = '23503';
  end if;
  return new;
end;
$function$;

revoke all on function private.validate_chat_media_object() from public, anon, authenticated;

create trigger chat_media_validate_uploaded_object
before insert on public.chat_media
for each row execute function private.validate_chat_media_object();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'looply-chat',
  'looply-chat',
  false,
  104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'application/pdf', 'text/plain']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.letters enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_notifications enable row level security;
alter table public.chat_media enable row level security;

revoke all on table public.conversations, public.conversation_participants, public.letters,
  public.chat_messages, public.chat_notifications, public.chat_media from public, anon, authenticated;

grant select on public.conversations, public.conversation_participants, public.letters,
  public.chat_messages, public.chat_notifications, public.chat_media to authenticated;
grant insert (conversation_id, sender_id, reply_to, body) on public.chat_messages to authenticated;
grant update (body) on public.chat_messages to authenticated;
grant delete on public.chat_messages to authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;
grant update (read_at) on public.chat_notifications to authenticated;
grant insert (conversation_id, message_id, created_by, storage_path, mime_type, byte_size, file_name)
  on public.chat_media to authenticated;

create policy conversations_select_participants
on public.conversations for select to authenticated
using ((select private.is_conversation_participant(id)));

create policy conversation_participants_select_members
on public.conversation_participants for select to authenticated
using ((select private.is_conversation_participant(conversation_id)));

create policy conversation_participants_update_own_read_marker
on public.conversation_participants for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy letters_select_participants
on public.letters for select to authenticated
using ((select private.is_conversation_participant(conversation_id)));

create policy chat_messages_select_participants
on public.chat_messages for select to authenticated
using ((select private.is_conversation_participant(conversation_id)));

create policy chat_messages_insert_participants
on public.chat_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and (select private.is_conversation_participant(conversation_id))
);

create policy chat_messages_update_own
on public.chat_messages for update to authenticated
using (
  sender_id = (select auth.uid())
  and (select private.is_conversation_participant(conversation_id))
)
with check (
  sender_id = (select auth.uid())
  and (select private.is_conversation_participant(conversation_id))
);

create policy chat_messages_delete_own
on public.chat_messages for delete to authenticated
using (
  sender_id = (select auth.uid())
  and (select private.is_conversation_participant(conversation_id))
);

create policy chat_notifications_select_own
on public.chat_notifications for select to authenticated
using (user_id = (select auth.uid()));

create policy chat_notifications_update_own
on public.chat_notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy chat_media_select_participants
on public.chat_media for select to authenticated
using ((select private.is_conversation_participant(conversation_id)));

create policy chat_media_insert_own_message
on public.chat_media for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.chat_messages as message
    where message.id = public.chat_media.message_id
      and message.conversation_id = public.chat_media.conversation_id
      and message.sender_id = (select auth.uid())
  )
  and (select private.is_conversation_participant(conversation_id))
);

create policy looply_chat_read_participants
on storage.objects for select to authenticated
using (
  bucket_id = 'looply-chat'
  and (
    exists (
      select 1 from public.chat_media as media
      where media.storage_path = storage.objects.name
        and (select private.is_conversation_participant(media.conversation_id))
    )
    or exists (
      select 1 from public.chat_messages as own_message
      where own_message.id = private.try_uuid(split_part(storage.objects.name, '/', 3))
        and own_message.conversation_id = private.try_uuid(split_part(storage.objects.name, '/', 2))
        and own_message.sender_id = (select auth.uid())
    )
  )
);

create policy looply_chat_insert_own_message
on storage.objects for insert to authenticated
with check (
  bucket_id = 'looply-chat'
  and name ~ '^conversations/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|jpeg|png|webp|mp4|webm|mp3|ogg|pdf|txt)$'
  and exists (
    select 1 from public.chat_messages as message
    where message.id = private.try_uuid(split_part(name, '/', 3))
      and message.conversation_id = private.try_uuid(split_part(name, '/', 2))
      and message.sender_id = (select auth.uid())
  )
);

create policy looply_chat_delete_own_message
on storage.objects for delete to authenticated
using (
  bucket_id = 'looply-chat'
  and exists (
    select 1 from public.chat_messages as message
    where message.id = private.try_uuid(split_part(name, '/', 3))
      and message.conversation_id = private.try_uuid(split_part(name, '/', 2))
      and message.sender_id = (select auth.uid())
  )
);

alter table private.admin_audit drop constraint admin_audit_resource_type_check;
alter table private.admin_audit add constraint admin_audit_resource_type_check
  check (resource_type in (
    'posts', 'music_dedications', 'profiles', 'post_media', 'music_comments',
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
     or p_event not in ('access_denied', 'read_requested', 'read_completed', 'read_failed')
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

alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.conversation_participants;
alter publication supabase_realtime add table public.letters;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_notifications;
alter publication supabase_realtime add table public.chat_media;

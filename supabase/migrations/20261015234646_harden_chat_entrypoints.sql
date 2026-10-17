-- Cria conversas somente por uma Edge Function autenticada e indexa as FKs novas.

drop function public.create_direct_conversation(uuid);
drop function public.create_admin_letter(text, text);

create or replace function public.create_direct_conversation(p_actor_id uuid, p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_conversation_id uuid;
  key_value text;
  target_visibility text;
begin
  if p_actor_id is null or p_target_id is null or p_target_id = p_actor_id
     or not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    raise exception 'Invalid conversation participants' using errcode = '22023';
  end if;

  select profile.profile_visibility into target_visibility
  from public.profiles as profile where profile.id = p_target_id;
  if target_visibility is null or (target_visibility = 'private' and not public.is_looply_admin(p_actor_id)) then
    raise exception 'Profile is not available' using errcode = '42501';
  end if;

  key_value := least(p_actor_id, p_target_id)::text || ':' || greatest(p_actor_id, p_target_id)::text;
  insert into public.conversations (kind, created_by, direct_key)
  values ('direct', p_actor_id, key_value)
  on conflict (direct_key) where kind = 'direct' do nothing
  returning id into new_conversation_id;

  if new_conversation_id is null then
    select conversation.id into new_conversation_id
    from public.conversations as conversation
    where conversation.kind = 'direct' and conversation.direct_key = key_value;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (new_conversation_id, p_actor_id), (new_conversation_id, p_target_id)
  on conflict (conversation_id, user_id) do nothing;
  return new_conversation_id;
end;
$function$;

revoke all on function public.create_direct_conversation(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_direct_conversation(uuid, uuid) to service_role;

create or replace function public.create_admin_letter(p_actor_id uuid, p_subject text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  admin_id uuid;
  new_conversation_id uuid;
  new_message_id uuid;
  clean_subject text := btrim(coalesce(p_subject, ''));
  clean_body text := btrim(coalesce(p_body, ''));
begin
  if p_actor_id is null
     or not exists (select 1 from public.profiles as actor where actor.id = p_actor_id)
     or char_length(clean_subject) not between 1 and 120
     or char_length(clean_body) not between 1 and 5000 then
    raise exception 'Invalid letter request' using errcode = '22023';
  end if;

  select administrator.user_id into admin_id
  from private.admin_users as administrator
  join public.profiles as profile on profile.id = administrator.user_id
  where profile.username = 'peixinho'
    and public.is_looply_admin(administrator.user_id)
  order by administrator.granted_at
  limit 1;
  if admin_id is null then
    raise exception 'Peixinho is not yet available as the verified administrator' using errcode = '55000';
  end if;
  if p_actor_id = admin_id then
    raise exception 'Use a regular conversation to write to yourself' using errcode = '22023';
  end if;

  insert into public.conversations (kind, created_by, subject)
  values ('letter', p_actor_id, clean_subject)
  returning id into new_conversation_id;
  insert into public.conversation_participants (conversation_id, user_id)
  values (new_conversation_id, p_actor_id), (new_conversation_id, admin_id);
  insert into public.letters (conversation_id, sender_id, recipient_id, subject)
  values (new_conversation_id, p_actor_id, admin_id, clean_subject);
  insert into public.chat_messages (conversation_id, sender_id, body)
  values (new_conversation_id, p_actor_id, clean_body)
  returning id into new_message_id;
  update public.letters as letter
    set initial_message_id = new_message_id
    where letter.conversation_id = new_conversation_id;
  return new_conversation_id;
end;
$function$;

revoke all on function public.create_admin_letter(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_admin_letter(uuid, text, text) to service_role;

create index chat_media_created_by_idx on public.chat_media (created_by);
create index chat_media_message_fk_idx on public.chat_media (message_id, conversation_id);
create index chat_messages_reply_fk_idx on public.chat_messages (reply_to, conversation_id) where reply_to is not null;
create index chat_notifications_conversation_idx on public.chat_notifications (conversation_id);
create index chat_notifications_message_fk_idx on public.chat_notifications (message_id, conversation_id);
create index conversations_created_by_idx on public.conversations (created_by);
create index letters_initial_message_fk_idx on public.letters (initial_message_id, conversation_id) where initial_message_id is not null;

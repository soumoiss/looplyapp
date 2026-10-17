-- Enable private group conversations while preserving the existing direct and letter records.
alter table public.conversations
  drop constraint conversations_kind_check;
alter table public.conversations
  add constraint conversations_kind_check check (kind in ('direct', 'letter', 'group'));

alter table public.conversations
  drop constraint conversations_subject_kind;
alter table public.conversations
  add constraint conversations_subject_kind check (
    (kind = 'direct' and subject is null and direct_key is not null)
    or (kind in ('letter', 'group') and subject is not null and direct_key is null)
  );

create or replace function public.create_group_conversation(
  p_actor_id uuid,
  p_target_ids uuid[],
  p_subject text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  clean_subject text := btrim(coalesce(p_subject, ''));
  unique_target_count integer;
  new_conversation_id uuid;
begin
  if p_actor_id is null
     or coalesce(cardinality(p_target_ids), 0) not between 2 and 49
     or char_length(clean_subject) not between 1 and 120
     or not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    raise exception 'Invalid group request' using errcode = '22023';
  end if;

  select count(distinct target.user_id)::integer
  into unique_target_count
  from unnest(p_target_ids) as target(user_id);

  if unique_target_count <> cardinality(p_target_ids)
     or p_actor_id = any(p_target_ids) then
    raise exception 'Invalid group members' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_target_ids) as target(user_id)
    left join public.profiles as profile on profile.id = target.user_id
    where profile.id is null or profile.profile_visibility = 'private'
  ) then
    raise exception 'One or more profiles are unavailable' using errcode = '42501';
  end if;

  insert into public.conversations (kind, created_by, subject)
  values ('group', p_actor_id, clean_subject)
  returning id into new_conversation_id;

  insert into public.conversation_participants (conversation_id, user_id)
  select new_conversation_id, p_actor_id
  union all
  select new_conversation_id, target.user_id
  from unnest(p_target_ids) as target(user_id);

  return new_conversation_id;
end;
$function$;

revoke all on function public.create_group_conversation(uuid, uuid[], text) from public, anon, authenticated, service_role;
grant execute on function public.create_group_conversation(uuid, uuid[], text) to service_role;

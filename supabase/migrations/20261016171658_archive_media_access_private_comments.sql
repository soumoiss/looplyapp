-- Archive media access is managed through the audited admin Edge Function.
-- Comment audiences are stored independently from media visibility.

create or replace function public.set_looply_archive_media_access(
  p_actor_id uuid,
  p_media_id uuid,
  p_visibility text,
  p_viewer_ids uuid[] default '{}'::uuid[],
  p_comment_access text default 'disabled',
  p_commenter_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_duplicate_count integer;
  v_invalid_count integer;
begin
  if p_actor_id is null or p_media_id is null
     or not exists (select 1 from private.admin_users a where a.user_id = p_actor_id) then
    raise exception 'Administrator membership required' using errcode = '42501';
  end if;
  if p_visibility is null or p_visibility not in ('members', 'exclusive') then
    raise exception 'Invalid media visibility' using errcode = '22023';
  end if;
  if p_comment_access is null or p_comment_access not in ('viewers', 'selected', 'disabled') then
    raise exception 'Invalid comment access' using errcode = '22023';
  end if;

  perform 1 from public.archive_media media where media.id = p_media_id for update;
  if not found then
    raise exception 'Archive media does not exist' using errcode = 'P0002';
  end if;

  select count(*) - count(distinct selected.user_id)
  into v_duplicate_count
  from unnest(coalesce(p_viewer_ids, '{}'::uuid[])) as selected(user_id);
  if v_duplicate_count > 0 or exists (
    select 1 from unnest(coalesce(p_viewer_ids, '{}'::uuid[])) as selected(user_id)
    where selected.user_id is null
  ) then
    raise exception 'Viewer list contains duplicate or null identities' using errcode = '22023';
  end if;

  select count(*) - count(distinct selected.user_id)
  into v_duplicate_count
  from unnest(coalesce(p_commenter_ids, '{}'::uuid[])) as selected(user_id);
  if v_duplicate_count > 0 or exists (
    select 1 from unnest(coalesce(p_commenter_ids, '{}'::uuid[])) as selected(user_id)
    where selected.user_id is null
  ) then
    raise exception 'Commenter list contains duplicate or null identities' using errcode = '22023';
  end if;

  select count(*) into v_invalid_count
  from unnest(coalesce(p_viewer_ids, '{}'::uuid[])) as selected(user_id)
  left join public.profiles profile on profile.id = selected.user_id
  where profile.id is null;
  if v_invalid_count > 0 then
    raise exception 'Viewer list contains an unknown identity' using errcode = '22023';
  end if;

  select count(*) into v_invalid_count
  from unnest(coalesce(p_commenter_ids, '{}'::uuid[])) as selected(user_id)
  left join public.profiles profile on profile.id = selected.user_id
  where profile.id is null;
  if v_invalid_count > 0 then
    raise exception 'Commenter list contains an unknown identity' using errcode = '22023';
  end if;

  if p_visibility = 'exclusive' and cardinality(coalesce(p_viewer_ids, '{}'::uuid[])) = 0 then
    raise exception 'Select at least one viewer for exclusive media' using errcode = '22023';
  end if;
  if p_visibility = 'members' and cardinality(coalesce(p_viewer_ids, '{}'::uuid[])) > 0 then
    raise exception 'Viewer identities require exclusive media visibility' using errcode = '22023';
  end if;
  if p_comment_access = 'selected' and cardinality(coalesce(p_commenter_ids, '{}'::uuid[])) = 0 then
    raise exception 'Select at least one commenter' using errcode = '22023';
  end if;
  if p_comment_access <> 'selected' and cardinality(coalesce(p_commenter_ids, '{}'::uuid[])) > 0 then
    raise exception 'Commenter identities require selected comment access' using errcode = '22023';
  end if;
  if p_visibility = 'exclusive' and exists (
    select 1 from unnest(coalesce(p_commenter_ids, '{}'::uuid[])) as commenter(user_id)
    where not (commenter.user_id = any(coalesce(p_viewer_ids, '{}'::uuid[])))
      and not exists (select 1 from private.admin_users a where a.user_id = commenter.user_id)
  ) then
    raise exception 'Exclusive media commenters must also be viewers' using errcode = '22023';
  end if;

  delete from public.archive_media_recipients where media_id = p_media_id;
  delete from public.archive_media_commenters where media_id = p_media_id;

  if p_visibility = 'exclusive' then
    insert into public.archive_media_recipients(media_id, user_id)
    select p_media_id, viewer.user_id
    from unnest(coalesce(p_viewer_ids, '{}'::uuid[])) as viewer(user_id);
  end if;

  if p_comment_access = 'selected' then
    insert into public.archive_media_commenters(media_id, user_id)
    select p_media_id, commenter.user_id
    from unnest(coalesce(p_commenter_ids, '{}'::uuid[])) as commenter(user_id);
  end if;

  update public.archive_media
  set visibility = p_visibility, comment_access = p_comment_access, updated_at = now()
  where id = p_media_id;
end;
$function$;

revoke all on function public.set_looply_archive_media_access(uuid, uuid, text, uuid[], text, uuid[])
  from public, anon, authenticated;
grant execute on function public.set_looply_archive_media_access(uuid, uuid, text, uuid[], text, uuid[])
  to service_role;

create or replace function public.create_archive_media_comment(
  p_media_id uuid,
  p_body text,
  p_audience text default 'media_viewers',
  p_recipient_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_comment_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_duplicate_count integer;
  v_invalid_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not private.can_comment_archive_media(p_media_id) then
    raise exception 'Not permitted to comment on this media' using errcode = '42501';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 2000 then
    raise exception 'Comment must contain between 1 and 2000 characters' using errcode = '22023';
  end if;
  if p_audience is null or p_audience not in ('media_viewers', 'members', 'selected', 'author_only') then
    raise exception 'Invalid comment audience' using errcode = '22023';
  end if;

  select count(*) - count(distinct selected.user_id)
  into v_duplicate_count
  from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) as selected(user_id);
  if v_duplicate_count > 0 or exists (
    select 1 from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) as selected(user_id)
    where selected.user_id is null
  ) then
    raise exception 'Comment audience contains duplicate or null identities' using errcode = '22023';
  end if;

  select count(*) into v_invalid_count
  from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) as selected(user_id)
  left join public.profiles profile on profile.id = selected.user_id
  where profile.id is null;
  if v_invalid_count > 0 then
    raise exception 'Comment audience contains an unknown identity' using errcode = '22023';
  end if;

  if p_audience = 'selected' and cardinality(coalesce(p_recipient_ids, '{}'::uuid[])) = 0 then
    raise exception 'Select at least one comment recipient' using errcode = '22023';
  end if;
  if p_audience <> 'selected' and cardinality(coalesce(p_recipient_ids, '{}'::uuid[])) > 0 then
    raise exception 'Recipient identities require selected comment audience' using errcode = '22023';
  end if;

  insert into public.archive_media_comments(media_id, author_id, body, audience)
  values (p_media_id, v_user_id, v_body, p_audience)
  returning id into v_comment_id;

  if p_audience = 'selected' then
    insert into public.archive_media_comment_recipients(comment_id, user_id)
    select v_comment_id, recipient.user_id
    from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) as recipient(user_id);
  end if;
  return v_comment_id;
end;
$function$;

revoke all on function public.create_archive_media_comment(uuid, text, text, uuid[])
  from public, anon;
grant execute on function public.create_archive_media_comment(uuid, text, text, uuid[])
  to authenticated;

drop policy if exists archive_media_commenters_admin_read on public.archive_media_commenters;
create policy archive_media_commenters_self_or_admin_read
on public.archive_media_commenters
for select to authenticated
using (user_id = (select auth.uid()) or (select private.can_manage_archive_media(media_id)));


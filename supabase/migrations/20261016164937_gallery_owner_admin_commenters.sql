create or replace function public.set_community_gallery_media_access(
  p_media_id uuid,
  p_visibility text,
  p_viewer_ids uuid[] default '{}'::uuid[],
  p_comment_access text default 'disabled',
  p_commenter_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_owner_id uuid;
  v_invalid_count integer;
  v_duplicate_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_visibility not in ('members', 'exclusive') then
    raise exception 'Invalid media visibility' using errcode = '22023';
  end if;
  if p_comment_access not in ('viewers', 'selected', 'disabled') then
    raise exception 'Invalid comment access' using errcode = '22023';
  end if;
  if not private.can_manage_community_gallery_media(p_media_id) then
    raise exception 'Not permitted to manage this media' using errcode = '42501';
  end if;
  select media.owner_id into v_owner_id
  from public.community_gallery_media as media where media.id = p_media_id;

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

  if p_comment_access = 'selected' and cardinality(coalesce(p_commenter_ids, '{}'::uuid[])) = 0 then
    raise exception 'Select at least one commenter' using errcode = '22023';
  end if;
  if p_comment_access <> 'selected' and cardinality(coalesce(p_commenter_ids, '{}'::uuid[])) > 0 then
    raise exception 'Commenter identities require selected comment access' using errcode = '22023';
  end if;
  if p_visibility = 'exclusive' and exists (
    select 1 from unnest(coalesce(p_commenter_ids, '{}'::uuid[])) as commenter(user_id)
    where not (commenter.user_id = any(coalesce(p_viewer_ids, '{}'::uuid[])))
      and commenter.user_id <> v_owner_id
      and not public.is_looply_admin(commenter.user_id)
  ) then
    raise exception 'Exclusive media commenters must be viewers, the owner, or an administrator' using errcode = '22023';
  end if;

  delete from public.community_gallery_media_recipients
  where media_id = p_media_id;
  delete from public.community_gallery_media_commenters
  where media_id = p_media_id;

  if p_visibility = 'exclusive' then
    insert into public.community_gallery_media_recipients(media_id, user_id, can_view, can_comment)
    select p_media_id, viewer.user_id, true,
      viewer.user_id = any(coalesce(p_commenter_ids, '{}'::uuid[]))
    from unnest(coalesce(p_viewer_ids, '{}'::uuid[])) as viewer(user_id);
  end if;

  if p_comment_access = 'selected' then
    insert into public.community_gallery_media_commenters(media_id, user_id)
    select p_media_id, commenter.user_id
    from unnest(coalesce(p_commenter_ids, '{}'::uuid[])) as commenter(user_id);
  end if;

  update public.community_gallery_media
  set visibility = p_visibility, comment_access = p_comment_access
  where id = p_media_id;
end;
$function$;



-- Salva configurações de galeria e listas de acesso em uma única transação autenticada.
create or replace function public.set_gallery_media_permissions(
  p_source text,
  p_media_id uuid,
  p_visibility text,
  p_comment_access text,
  p_viewer_ids uuid[],
  p_commenter_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := auth.uid();
  viewer_ids uuid[] := coalesce(p_viewer_ids, array[]::uuid[]);
  commenter_ids uuid[] := coalesce(p_commenter_ids, array[]::uuid[]);
  item_owner uuid;
begin
  if actor is null
    or p_media_id is null
    or p_source not in ('archive','community')
    or p_visibility not in ('members','exclusive')
    or p_comment_access not in ('viewers','selected','disabled')
    or cardinality(viewer_ids) > 100
    or cardinality(commenter_ids) > 100
    or cardinality(viewer_ids) <> (select count(distinct id) from unnest(viewer_ids) as id)
    or cardinality(commenter_ids) <> (select count(distinct id) from unnest(commenter_ids) as id)
  then
    raise exception 'Invalid gallery permissions' using errcode = '22023';
  end if;

  if p_visibility = 'exclusive' and cardinality(viewer_ids) = 0 then
    raise exception 'Exclusive media needs at least one viewer' using errcode = '22023';
  end if;
  if p_visibility = 'exclusive' and p_comment_access = 'selected'
    and not (commenter_ids <@ viewer_ids)
  then
    raise exception 'Selected commenters must be able to view exclusive media' using errcode = '22023';
  end if;
  if p_comment_access = 'selected' and cardinality(commenter_ids) = 0 then
    raise exception 'Selected comment access needs at least one commenter' using errcode = '22023';
  end if;
  if exists (
    select selected_id from unnest(viewer_ids || commenter_ids) as selected_id
    where not exists (select 1 from public.profiles p where p.id = selected_id)
  ) then
    raise exception 'Unknown gallery member' using errcode = '22023';
  end if;

  if p_source = 'archive' then
    if not (select private.is_admin()) then
      raise exception 'Only the administrator can manage archived gallery media' using errcode = '42501';
    end if;
    update public.archive_media
      set visibility = p_visibility, comment_access = p_comment_access, updated_at = now()
      where id = p_media_id;
    if not found then raise exception 'Gallery media unavailable' using errcode = 'P0002'; end if;
    delete from public.archive_media_recipients where media_id = p_media_id;
    delete from public.archive_media_commenters where media_id = p_media_id;
    if p_visibility = 'exclusive' then
      insert into public.archive_media_recipients(media_id,user_id)
        select p_media_id, selected_id from unnest(viewer_ids) as selected_id;
    end if;
    if p_comment_access = 'selected' then
      insert into public.archive_media_commenters(media_id,user_id)
        select p_media_id, selected_id from unnest(commenter_ids) as selected_id;
    end if;
  else
    select owner_id into item_owner from public.community_gallery_media where id = p_media_id;
    if item_owner is null or (item_owner <> actor and not (select private.is_admin())) then
      raise exception 'Gallery media unavailable' using errcode = '42501';
    end if;
    update public.community_gallery_media
      set visibility = p_visibility, comment_access = p_comment_access
      where id = p_media_id;
    delete from public.community_gallery_media_recipients where media_id = p_media_id;
    delete from public.community_gallery_media_commenters where media_id = p_media_id;
    if p_visibility = 'exclusive' then
      insert into public.community_gallery_media_recipients(media_id,user_id,can_view,can_comment)
        select p_media_id, selected_id, true, (selected_id = any(commenter_ids))
        from unnest(viewer_ids) as selected_id;
    end if;
    if p_comment_access = 'selected' then
      insert into public.community_gallery_media_commenters(media_id,user_id)
        select p_media_id, selected_id from unnest(commenter_ids) as selected_id;
    end if;
  end if;
end;
$function$;

revoke all on function public.set_gallery_media_permissions(text,uuid,text,text,uuid[],uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.set_gallery_media_permissions(text,uuid,text,text,uuid[],uuid[])
  to authenticated;

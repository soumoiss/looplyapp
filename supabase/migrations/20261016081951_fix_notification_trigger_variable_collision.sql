-- Avoid PL/pgSQL variable/column collisions in notification upserts.
-- This trigger runs after posts, selected recipients, comments, and music dedications.
create or replace function private.create_looply_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  v_target_id uuid;
  v_resource_id uuid;
  v_event_id uuid;
  v_notification_kind text;
  v_notification_preview text;
  v_post_author_id uuid;
  v_parent_author_id uuid;
begin
  if tg_table_name = 'posts' then
    v_actor_id := new.author_id;
    v_resource_id := new.id;
    v_event_id := new.id;
    v_notification_kind := 'post';
    v_notification_preview := 'Nova publicação';
    if new.visibility = 'public' then
      insert into public.notifications (recipient_id, actor_id, kind, resource_id, event_id, preview)
      select profile.id, v_actor_id, v_notification_kind, v_resource_id, v_event_id, v_notification_preview
      from public.profiles as profile
      where profile.id <> v_actor_id
      on conflict on constraint notifications_recipient_event_unique do nothing;
    end if;
  elsif tg_table_name = 'post_recipients' then
    select post.author_id into v_actor_id
    from public.posts as post
    where post.id = new.post_id;
    if v_actor_id is not null and v_actor_id <> new.recipient_id then
      insert into public.notifications (recipient_id, actor_id, kind, resource_id, event_id, preview)
      values (new.recipient_id, v_actor_id, 'post', new.post_id, new.post_id, 'Nova publicação compartilhada com você')
      on conflict on constraint notifications_recipient_event_unique do nothing;
    end if;
  elsif tg_table_name = 'comments' then
    v_actor_id := new.author_id;
    v_resource_id := new.post_id;
    v_event_id := new.id;
    v_notification_kind := case when new.parent_comment_id is null then 'comment' else 'reply' end;
    v_notification_preview := left(btrim(new.body), 180);
    select post.author_id into v_post_author_id
    from public.posts as post
    where post.id = new.post_id;
    if new.parent_comment_id is not null then
      select parent.author_id into v_parent_author_id
      from public.comments as parent
      where parent.id = new.parent_comment_id
        and parent.post_id = new.post_id;
    end if;
    for v_target_id in
      select distinct candidate.id
      from unnest(array[v_post_author_id, v_parent_author_id]) as recipients(id)
      join public.profiles as candidate on candidate.id = recipients.id
      where candidate.id <> v_actor_id
    loop
      insert into public.notifications (recipient_id, actor_id, kind, resource_id, event_id, preview)
      values (v_target_id, v_actor_id, v_notification_kind, v_resource_id, v_event_id, v_notification_preview)
      on conflict on constraint notifications_recipient_event_unique do nothing;
    end loop;
  elsif tg_table_name = 'music_dedications' then
    v_actor_id := new.sender_id;
    v_target_id := new.recipient_id;
    if v_target_id <> v_actor_id then
      insert into public.notifications (recipient_id, actor_id, kind, resource_id, event_id, preview)
      values (v_target_id, v_actor_id, 'music_dedication', new.id, new.id, 'Nova dedicatória musical')
      on conflict on constraint notifications_recipient_event_unique do nothing;
    end if;
  end if;
  return new;
end;
$function$;

-- Story engagement and private replies, protected by the active story audience.

create table public.story_views (
  story_id uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  view_count integer not null default 1 check (view_count > 0),
  primary key (story_id, viewer_id)
);
create index story_views_viewer_seen_idx on public.story_views (viewer_id, viewed_at desc);
create index story_views_story_seen_idx on public.story_views (story_id, viewed_at desc);

create table public.story_likes (
  story_id uuid not null references public.stories (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index story_likes_user_created_idx on public.story_likes (user_id, created_at desc);

create table public.story_replies (
  story_id uuid not null references public.stories (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id uuid not null,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id),
  foreign key (message_id, conversation_id)
    references public.chat_messages (id, conversation_id) on delete cascade
);
create index story_replies_story_created_idx on public.story_replies (story_id, created_at desc);
create index story_replies_sender_created_idx on public.story_replies (sender_id, created_at desc);

alter table public.story_views enable row level security;
alter table public.story_likes enable row level security;
alter table public.story_replies enable row level security;
revoke all on table public.story_views, public.story_likes, public.story_replies from public, anon, authenticated;
grant select on public.story_views, public.story_replies to authenticated;
grant select, insert, delete on public.story_likes to authenticated;

create policy story_views_select_viewer_or_author
on public.story_views for select to authenticated
using (
  viewer_id = (select auth.uid())
  or exists (
    select 1 from public.stories as s
    where s.id = story_id and s.author_id = (select auth.uid())
  )
);

create policy story_likes_select_liker_or_author
on public.story_likes for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.stories as s
    where s.id = story_id and s.author_id = (select auth.uid())
  )
);
create policy story_likes_insert_authorized_viewer
on public.story_likes for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.stories as s
    where s.id = story_id
      and s.author_id <> (select auth.uid())
      and (select private.can_view_story(s.id))
  )
);
create policy story_likes_delete_own
on public.story_likes for delete to authenticated
using (user_id = (select auth.uid()));

create policy story_replies_select_sender_or_story_author
on public.story_replies for select to authenticated
using (
  sender_id = (select auth.uid())
  or exists (
    select 1 from public.stories as s
    where s.id = story_id and s.author_id = (select auth.uid())
  )
);

create or replace function public.record_story_view(p_story_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  story_author_id uuid;
  saved_view public.story_views%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select s.author_id into story_author_id
  from public.stories as s
  where s.id = p_story_id and s.expires_at > now();
  if story_author_id is null or not private.can_view_story(p_story_id) then
    raise exception 'Story is unavailable' using errcode = '42501';
  end if;
  if story_author_id = actor_id then
    return jsonb_build_object('recorded', false);
  end if;

  insert into public.story_views (story_id, viewer_id)
  values (p_story_id, actor_id)
  on conflict (story_id, viewer_id) do update
    set last_viewed_at = now(), view_count = public.story_views.view_count + 1
  returning * into saved_view;

  return jsonb_build_object(
    'recorded', true,
    'viewedAt', saved_view.viewed_at,
    'lastViewedAt', saved_view.last_viewed_at,
    'viewCount', saved_view.view_count
  );
end;
$function$;
revoke all on function public.record_story_view(uuid) from public, anon, authenticated;
grant execute on function public.record_story_view(uuid) to authenticated;

create or replace function public.send_story_reply(p_story_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  story_author_id uuid;
  conversation_id uuid;
  message_id uuid;
  clean_body text := btrim(coalesce(p_body, ''));
  message_body text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(clean_body) not between 1 and 2000 then
    raise exception 'Story reply is invalid' using errcode = '22023';
  end if;

  select s.author_id into story_author_id
  from public.stories as s
  where s.id = p_story_id and s.expires_at > now();
  if story_author_id is null or story_author_id = actor_id
     or not private.can_view_story(p_story_id) then
    raise exception 'Story is unavailable for private reply' using errcode = '42501';
  end if;

  conversation_id := public.create_direct_conversation(actor_id, story_author_id);
  message_body := '↩ Resposta ao seu story' || E'\n\n' || clean_body;
  insert into public.chat_messages (conversation_id, sender_id, body)
  values (conversation_id, actor_id, message_body)
  returning id into message_id;
  insert into public.story_replies (story_id, conversation_id, message_id, sender_id)
  values (p_story_id, conversation_id, message_id, actor_id);

  return jsonb_build_object('conversation_id', conversation_id, 'message_id', message_id);
end;
$function$;
revoke all on function public.send_story_reply(uuid, text) from public, anon, authenticated;
grant execute on function public.send_story_reply(uuid, text) to authenticated;

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'story_views'
    ) then
      execute 'alter publication supabase_realtime add table public.story_views';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'story_likes'
    ) then
      execute 'alter publication supabase_realtime add table public.story_likes';
    end if;
  end if;
end;
$publication$;


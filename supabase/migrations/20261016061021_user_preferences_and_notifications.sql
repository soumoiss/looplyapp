-- Preferências sincronizadas por perfil e notificações internas persistentes.

alter table public.profiles
  add column if not exists theme text not null default 'lilas'
    check (theme in ('lilas', 'noite', 'oceano', 'rosa', 'floresta', 'system')),
  add column if not exists font_family text not null default 'system'
    check (font_family in ('system', 'sans', 'serif', 'rounded')),
  add column if not exists font_size text not null default 'normal'
    check (font_size in ('small', 'normal', 'large', 'very_large'));

grant select (theme, font_family, font_size) on table public.profiles to anon, authenticated;
grant update (theme, font_family, font_size) on table public.profiles to authenticated;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('post', 'comment', 'reply', 'music_dedication')),
  resource_id uuid not null,
  event_id uuid not null,
  preview text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_preview_length check (char_length(preview) <= 180),
  constraint notifications_recipient_event_unique unique (recipient_id, kind, event_id)
);

create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;
revoke all on table public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notifications_select_recipient
on public.notifications for select to authenticated
using (recipient_id = (select auth.uid()));

create policy notifications_update_read_recipient
on public.notifications for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

create or replace function private.create_looply_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  target_id uuid;
  resource_id uuid;
  event_id uuid;
  notification_kind text;
  notification_preview text;
  post_author_id uuid;
  parent_author_id uuid;
begin
  if tg_table_name = 'posts' then
    actor_id := new.author_id;
    resource_id := new.id;
    event_id := new.id;
    notification_kind := 'post';
    notification_preview := 'Nova publicação';
    if new.visibility = 'public' then
      insert into public.notifications (recipient_id, actor_id, kind, resource_id, event_id, preview)
      select profile.id, actor_id, notification_kind, resource_id, event_id, notification_preview
      from public.profiles as profile
      where profile.id <> actor_id
      on conflict (recipient_id, kind, event_id) do nothing;
    end if;
  elsif tg_table_name = 'post_recipients' then
    select post.author_id into actor_id from public.posts as post where post.id = new.post_id;
    if actor_id is not null and actor_id <> new.recipient_id then
      insert into public.notifications (recipient_id, actor_id, kind, resource_id, event_id, preview)
      values (new.recipient_id, actor_id, 'post', new.post_id, new.post_id, 'Nova publicação compartilhada com você')
      on conflict (recipient_id, kind, event_id) do nothing;
    end if;
  elsif tg_table_name = 'comments' then
    actor_id := new.author_id;
    resource_id := new.post_id;
    event_id := new.id;
    notification_kind := case when new.parent_comment_id is null then 'comment' else 'reply' end;
    notification_preview := left(btrim(new.body), 180);
    select post.author_id into post_author_id
      from public.posts as post where post.id = new.post_id;
    if new.parent_comment_id is not null then
      select parent.author_id into parent_author_id
        from public.comments as parent where parent.id = new.parent_comment_id and parent.post_id = new.post_id;
    end if;
    for target_id in
      select distinct candidate.id
      from unnest(array[post_author_id, parent_author_id]) as recipient_id
      join public.profiles as candidate on candidate.id = recipient_id
      where candidate.id <> actor_id
    loop
      insert into public.notifications (recipient_id, actor_id, kind, resource_id, event_id, preview)
      values (target_id, actor_id, notification_kind, resource_id, event_id, notification_preview)
      on conflict (recipient_id, kind, event_id) do nothing;
    end loop;
  elsif tg_table_name = 'music_dedications' then
    actor_id := new.sender_id;
    target_id := new.recipient_id;
    if target_id <> actor_id then
      insert into public.notifications (recipient_id, actor_id, kind, resource_id, event_id, preview)
      values (target_id, actor_id, 'music_dedication', new.id, new.id, 'Nova dedicatória musical')
      on conflict (recipient_id, kind, event_id) do nothing;
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.create_looply_notification() from public, anon, authenticated;

create trigger notifications_on_public_post
after insert on public.posts
for each row execute function private.create_looply_notification();

create trigger notifications_on_selected_post_recipient
after insert on public.post_recipients
for each row execute function private.create_looply_notification();

create trigger notifications_on_comment
after insert on public.comments
for each row execute function private.create_looply_notification();

create trigger notifications_on_music_dedication
after insert on public.music_dedications
for each row execute function private.create_looply_notification();

do $publication$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end
$publication$;

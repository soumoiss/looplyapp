-- Publicacoes e comentarios persistentes; a visibilidade de comentarios segue a da publicacao.

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  body text not null,
  visibility text not null default 'public'
    check (visibility in ('public', 'private', 'selected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_body_length check (char_length(btrim(body)) between 1 and 5000)
);

create index posts_author_created_idx on public.posts (author_id, created_at desc);
create index posts_public_feed_idx on public.posts (created_at desc)
  where visibility = 'public';

create table public.post_recipients (
  post_id uuid not null references public.posts (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, recipient_id)
);

create index post_recipients_recipient_idx
  on public.post_recipients (recipient_id, post_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  parent_comment_id uuid,
  body text not null,
  created_at timestamptz not null default now(),
  constraint comments_body_length check (char_length(btrim(body)) between 1 and 2000),
  constraint comments_parent_same_post_fk
    foreign key (parent_comment_id, post_id)
    references public.comments (id, post_id) on delete cascade,
  constraint comments_id_post_unique unique (id, post_id)
);

create index comments_post_created_idx on public.comments (post_id, created_at);
create index comments_author_created_idx on public.comments (author_id, created_at desc);
create index comments_parent_idx on public.comments (parent_comment_id, post_id)
  where parent_comment_id is not null;

create or replace function private.can_view_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.posts as p
    where p.id = p_post_id
      and (
        p.visibility = 'public'
        or p.author_id = (select auth.uid())
        or (
          p.visibility = 'selected'
          and exists (
            select 1
            from public.post_recipients as pr
            where pr.post_id = p.id
              and pr.recipient_id = (select auth.uid())
          )
        )
      )
  );
$function$;

revoke all on function private.can_view_post(uuid) from public, anon, authenticated;
grant usage on schema private to anon;
grant execute on function private.can_view_post(uuid) to anon, authenticated;

create or replace function public.create_selected_post(
  p_body text,
  p_recipient_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_post_id uuid;
  actor_id uuid := auth.uid();
  recipient_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 5000 then
    raise exception 'Post text must contain 1 to 5000 characters' using errcode = '22023';
  end if;
  if p_recipient_ids is null or cardinality(p_recipient_ids) < 1
     or cardinality(p_recipient_ids) > 20 then
    raise exception 'Choose between 1 and 20 recipients' using errcode = '22023';
  end if;

  select count(distinct requested.id)::integer
    into recipient_count
  from unnest(p_recipient_ids) as requested(id);

  if recipient_count <> cardinality(p_recipient_ids)
     or exists (
       select 1 from unnest(p_recipient_ids) as requested(id)
       where requested.id is null or requested.id = actor_id
     )
     or exists (
       select 1
       from unnest(p_recipient_ids) as requested(id)
       left join public.profiles as recipient on recipient.id = requested.id
       where recipient.id is null or recipient.profile_visibility = 'private'
     ) then
    raise exception 'Recipient list is invalid' using errcode = '22023';
  end if;

  insert into public.posts (author_id, body, visibility)
  values (actor_id, btrim(p_body), 'selected')
  returning id into new_post_id;

  insert into public.post_recipients (post_id, recipient_id)
  select new_post_id, requested.id
  from unnest(p_recipient_ids) as requested(id);

  return new_post_id;
end;
$function$;

revoke all on function public.create_selected_post(text, uuid[]) from public, anon, authenticated;
grant execute on function public.create_selected_post(text, uuid[]) to authenticated;

create or replace function private.touch_post_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function private.touch_post_updated_at() from public, anon, authenticated;

create trigger posts_touch_updated_at
before update on public.posts
for each row execute function private.touch_post_updated_at();

create or replace function private.enforce_one_comment_reply_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.parent_comment_id is not null and exists (
    select 1
    from public.comments as parent
    where parent.id = new.parent_comment_id
      and parent.post_id = new.post_id
      and parent.parent_comment_id is not null
  ) then
    raise exception 'Replies may not be nested more than one level' using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_one_comment_reply_level() from public, anon, authenticated;

create trigger comments_enforce_one_reply_level
before insert on public.comments
for each row execute function private.enforce_one_comment_reply_level();

alter table public.posts enable row level security;
alter table public.post_recipients enable row level security;
alter table public.comments enable row level security;

revoke all on table public.posts, public.post_recipients, public.comments
  from public, anon, authenticated;

grant select on public.posts, public.comments to anon, authenticated;
grant insert (author_id, body, visibility) on public.posts to authenticated;
grant update (body) on public.posts to authenticated;
grant delete on public.posts to authenticated;
grant select, insert, delete on public.post_recipients to authenticated;
grant insert (post_id, author_id, parent_comment_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;
grant delete on public.comments to authenticated;

create policy posts_read_visible
on public.posts
for select
to anon, authenticated
using ((select private.can_view_post(id)));

create policy posts_insert_own_public_or_private
on public.posts
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and visibility in ('public', 'private')
);

create policy posts_update_own
on public.posts
for update
to authenticated
using (author_id = (select auth.uid()))
with check (author_id = (select auth.uid()));

create policy posts_delete_own
on public.posts
for delete
to authenticated
using (author_id = (select auth.uid()));

create policy post_recipients_select_own_or_author
on public.post_recipients
for select
to authenticated
using (
  recipient_id = (select auth.uid())
  or exists (
    select 1 from public.posts as p
    where p.id = post_id and p.author_id = (select auth.uid())
  )
);

create policy post_recipients_insert_post_author
on public.post_recipients
for insert
to authenticated
with check (
  recipient_id <> (select auth.uid())
  and exists (
    select 1 from public.posts as p
    where p.id = post_id
      and p.author_id = (select auth.uid())
      and p.visibility = 'selected'
  )
);

create policy post_recipients_delete_post_author
on public.post_recipients
for delete
to authenticated
using (
  exists (
    select 1 from public.posts as p
    where p.id = post_id
      and p.author_id = (select auth.uid())
      and p.visibility = 'selected'
  )
);

create policy comments_read_with_post
on public.comments
for select
to anon, authenticated
using ((select private.can_view_post(post_id)));

create policy comments_insert_with_post
on public.comments
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.can_view_post(post_id))
);

create policy comments_update_own_with_post
on public.comments
for update
to authenticated
using (
  author_id = (select auth.uid())
  and (select private.can_view_post(post_id))
)
with check (
  author_id = (select auth.uid())
  and (select private.can_view_post(post_id))
);

create policy comments_delete_own_with_post
on public.comments
for delete
to authenticated
using (
  author_id = (select auth.uid())
  and (select private.can_view_post(post_id))
);

alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.comments;

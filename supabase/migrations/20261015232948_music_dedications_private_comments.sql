-- Dedicatórias persistentes; comentários pessoais são privados por padrão.

create table public.music_dedications (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  artist text not null default '',
  listen_url text not null,
  dedication_note text not null default '',
  created_at timestamptz not null default now(),
  constraint music_dedications_not_self check (sender_id <> recipient_id),
  constraint music_dedications_title_length check (char_length(btrim(title)) between 1 and 160),
  constraint music_dedications_artist_length check (char_length(artist) <= 120),
  constraint music_dedications_note_length check (char_length(dedication_note) <= 1000),
  constraint music_dedications_url_length check (char_length(listen_url) <= 1000),
  constraint music_dedications_allowed_link check (
    listen_url ~ '^https://(open\.spotify\.com|music\.youtube\.com|youtu\.be|www\.youtube\.com|youtube\.com|music\.apple\.com|soundcloud\.com)/'
  )
);

create index music_dedications_sender_idx on public.music_dedications (sender_id, created_at desc);
create index music_dedications_recipient_idx on public.music_dedications (recipient_id, created_at desc);

create table public.music_comments (
  id uuid primary key default gen_random_uuid(),
  dedication_id uuid not null references public.music_dedications (id) on delete cascade,
  author_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  body text not null,
  visibility text not null default 'private'
    check (visibility in ('private', 'participants')),
  created_at timestamptz not null default now(),
  constraint music_comments_body_length check (char_length(btrim(body)) between 1 and 2000)
);

create index music_comments_dedication_created_idx on public.music_comments (dedication_id, created_at);
create index music_comments_author_created_idx on public.music_comments (author_id, created_at desc);

alter table public.music_dedications enable row level security;
alter table public.music_comments enable row level security;
revoke all on table public.music_dedications, public.music_comments from public, anon, authenticated;

grant select on public.music_dedications, public.music_comments to authenticated;
grant insert (sender_id, recipient_id, title, artist, listen_url, dedication_note)
  on public.music_dedications to authenticated;
grant update (dedication_note) on public.music_dedications to authenticated;
grant delete on public.music_dedications to authenticated;
grant insert (dedication_id, author_id, body, visibility) on public.music_comments to authenticated;
grant update (body, visibility) on public.music_comments to authenticated;
grant delete on public.music_comments to authenticated;

create policy music_dedications_read_participants
on public.music_dedications
for select
to authenticated
using (
  sender_id = (select auth.uid())
  or recipient_id = (select auth.uid())
);

create policy music_dedications_insert_sender
on public.music_dedications
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and recipient_id <> (select auth.uid())
  and exists (
    select 1 from public.profiles as recipient
    where recipient.id = recipient_id
      and recipient.profile_visibility in ('members', 'public')
  )
);

create policy music_dedications_update_sender
on public.music_dedications
for update
to authenticated
using (sender_id = (select auth.uid()))
with check (sender_id = (select auth.uid()));

create policy music_dedications_delete_sender
on public.music_dedications
for delete
to authenticated
using (sender_id = (select auth.uid()));

create policy music_comments_read_author_or_shared_participant
on public.music_comments
for select
to authenticated
using (
  author_id = (select auth.uid())
  or (
    visibility = 'participants'
    and exists (
      select 1 from public.music_dedications as dedication
      where dedication.id = dedication_id
        and (dedication.sender_id = (select auth.uid()) or dedication.recipient_id = (select auth.uid()))
    )
  )
);

create policy music_comments_insert_participant
on public.music_comments
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.music_dedications as dedication
    where dedication.id = dedication_id
      and (dedication.sender_id = (select auth.uid()) or dedication.recipient_id = (select auth.uid()))
  )
);

create policy music_comments_update_author
on public.music_comments
for update
to authenticated
using (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.music_dedications as dedication
    where dedication.id = dedication_id
      and (dedication.sender_id = (select auth.uid()) or dedication.recipient_id = (select auth.uid()))
  )
)
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.music_dedications as dedication
    where dedication.id = dedication_id
      and (dedication.sender_id = (select auth.uid()) or dedication.recipient_id = (select auth.uid()))
  )
);

create policy music_comments_delete_author
on public.music_comments
for delete
to authenticated
using (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.music_dedications as dedication
    where dedication.id = dedication_id
      and (dedication.sender_id = (select auth.uid()) or dedication.recipient_id = (select auth.uid()))
  )
);

alter publication supabase_realtime add table public.music_dedications;
alter publication supabase_realtime add table public.music_comments;

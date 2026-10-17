-- 24-hour stories with private media and recipient-aware access.
create table public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  body text not null default '',
  visibility text not null default 'public'
    check (visibility in ('public', 'private', 'selected')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint stories_body_length check (char_length(body) <= 1000)
);
create index stories_author_created_idx on public.stories (author_id, created_at desc);
create index stories_expires_idx on public.stories (expires_at);
create table public.story_recipients (
  story_id uuid not null references public.stories (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, recipient_id)
);
create index story_recipients_recipient_idx on public.story_recipients (recipient_id, story_id);
create table public.story_media (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null unique references public.stories (id) on delete cascade,
  storage_path text not null unique,
  kind text not null check (kind in ('image', 'video')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')),
  byte_size bigint not null check (byte_size between 1 and 104857600),
  alt_text text not null default '',
  created_at timestamptz not null default now(),
  constraint story_media_kind_matches_mime check (
    (kind = 'image' and mime_type like 'image/%')
    or (kind = 'video' and mime_type like 'video/%')
  ),
  constraint story_media_alt_text_length check (char_length(alt_text) <= 500),
  constraint story_media_path_matches_story check (
    storage_path ~ ('^stories/' || story_id::text || '/[a-f0-9-]{36}\.(jpg|jpeg|png|webp|mp4|webm)$')
  )
);
create index story_media_story_created_idx on public.story_media (story_id, created_at);

create or replace function private.can_view_story(p_story_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.stories as s
    where s.id = p_story_id
      and s.expires_at > now()
      and (
        s.author_id = (select auth.uid())
        or s.visibility = 'public'
        or (
          s.visibility = 'selected'
          and exists (
            select 1
            from public.story_recipients as r
            where r.story_id = s.id
              and r.recipient_id = (select auth.uid())
          )
        )
      )
  );
$function$;
revoke all on function private.can_view_story(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_view_story(uuid) to authenticated;

create or replace function private.validate_story_media_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.stories as s
    join storage.objects as o
      on o.bucket_id = 'looply-media'
     and o.name = new.storage_path
    where s.id = new.story_id
      and s.author_id = (select auth.uid())
      and s.expires_at > now()
  ) then
    raise exception 'Uploaded story media object or owner is invalid' using errcode = '23503';
  end if;
  return new;
end;
$function$;
revoke all on function private.validate_story_media_object() from public, anon, authenticated;
create trigger story_media_validate_uploaded_object
before insert on public.story_media
for each row execute function private.validate_story_media_object();

alter table public.stories enable row level security;
alter table public.story_recipients enable row level security;
alter table public.story_media enable row level security;
revoke all on table public.stories, public.story_recipients, public.story_media from public, anon, authenticated;
grant select, delete on public.stories to authenticated;
grant insert (author_id, body, visibility) on public.stories to authenticated;
grant select, insert, delete on public.story_recipients to authenticated;
grant select, insert, delete on public.story_media to authenticated;

create policy stories_read_active_authorized
on public.stories for select to authenticated
using (expires_at > now() and (author_id = (select auth.uid()) or (select private.can_view_story(id))));
create policy stories_insert_own
on public.stories for insert to authenticated
with check (
  author_id = (select auth.uid())
  and visibility in ('public', 'private', 'selected')
  and char_length(body) <= 1000
);
create policy stories_delete_own
on public.stories for delete to authenticated
using (author_id = (select auth.uid()));

create policy story_recipients_select_own_or_author
on public.story_recipients for select to authenticated
using (
  recipient_id = (select auth.uid())
  or exists (
    select 1 from public.stories as s
    where s.id = story_id and s.author_id = (select auth.uid())
  )
);
create policy story_recipients_insert_author
on public.story_recipients for insert to authenticated
with check (
  recipient_id <> (select auth.uid())
  and exists (
    select 1
    from public.stories as s
    join public.profiles as p on p.id = story_recipients.recipient_id
    where s.id = story_id
      and s.author_id = (select auth.uid())
      and s.visibility = 'selected'
      and s.expires_at > now()
      and p.profile_visibility <> 'private'
  )
);
create policy story_recipients_delete_author
on public.story_recipients for delete to authenticated
using (
  exists (
    select 1 from public.stories as s
    where s.id = story_id and s.author_id = (select auth.uid())
  )
);

create policy story_media_read_authorized
on public.story_media for select to authenticated
using ((select private.can_view_story(story_id)));
create policy story_media_insert_author
on public.story_media for insert to authenticated
with check (
  exists (
    select 1 from public.stories as s
    where s.id = story_id and s.author_id = (select auth.uid()) and s.expires_at > now()
  )
);
create policy story_media_delete_author
on public.story_media for delete to authenticated
using (
  exists (
    select 1 from public.stories as s
    where s.id = story_id and s.author_id = (select auth.uid())
  )
);

create policy looply_media_read_authorized_story
on storage.objects for select to authenticated
using (
  bucket_id = 'looply-media'
  and exists (
    select 1 from public.story_media as m
    where m.storage_path = storage.objects.name
      and (select private.can_view_story(m.story_id))
  )
);
create policy looply_media_insert_story_author
on storage.objects for insert to authenticated
with check (
  bucket_id = 'looply-media'
  and (storage.foldername(name))[1] = 'stories'
  and private.try_uuid((storage.foldername(name))[2]) is not null
  and storage.filename(name) ~ '^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|mp4|webm)$'
  and exists (
    select 1 from public.stories as s
    where s.id = private.try_uuid((storage.foldername(name))[2])
      and s.author_id = (select auth.uid())
      and s.expires_at > now()
  )
);
create policy looply_media_delete_story_author
on storage.objects for delete to authenticated
using (
  bucket_id = 'looply-media'
  and (storage.foldername(name))[1] = 'stories'
  and exists (
    select 1 from public.stories as s
    where s.id = private.try_uuid((storage.foldername(name))[2])
      and s.author_id = (select auth.uid())
  )
);

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'stories'
     ) then
    execute 'alter publication supabase_realtime add table public.stories';
  end if;
end;
$publication$;

-- Private photo/video attachments for comments. Object access follows its post audience.

create table public.comment_media (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null,
  post_id uuid not null,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')),
  byte_size bigint not null check (byte_size between 1 and 104857600),
  created_at timestamptz not null default now(),
  constraint comment_media_comment_fk foreign key (comment_id, post_id)
    references public.comments (id, post_id) on delete cascade,
  constraint comment_media_path_matches_comment check (
    storage_path ~ ('^comments/' || post_id::text || '/' || comment_id::text || '/[a-f0-9-]{36}\.(jpg|jpeg|png|webp|mp4|webm)$')
  )
);

create index comment_media_comment_created_idx on public.comment_media (comment_id, created_at);
create index comment_media_post_idx on public.comment_media (post_id, created_at);

create or replace function private.validate_comment_media_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  comment_author uuid;
  comment_post uuid;
begin
  select comment.author_id, comment.post_id
    into comment_author, comment_post
  from public.comments as comment
  where comment.id = new.comment_id
  for update;

  if not found or comment_author <> new.author_id or comment_post <> new.post_id then
    raise exception 'Comment media must belong to its author and post' using errcode = '42501';
  end if;

  if not exists (
    select 1 from storage.objects as object
    where object.bucket_id = 'looply-media'
      and object.name = new.storage_path
  ) then
    raise exception 'Uploaded comment media object does not exist' using errcode = '23503';
  end if;

  if (select count(*) from public.comment_media as media where media.comment_id = new.comment_id) >= 4 then
    raise exception 'A comment can have at most 4 media files' using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.validate_comment_media_object() from public, anon, authenticated;

create trigger comment_media_validate_uploaded_object
before insert on public.comment_media
for each row execute function private.validate_comment_media_object();

alter table public.comment_media enable row level security;
revoke all on table public.comment_media from public, anon, authenticated;
grant select, delete on public.comment_media to authenticated;
grant insert (comment_id, post_id, storage_path, mime_type, byte_size)
  on public.comment_media to authenticated;

create policy comment_media_read_with_post
on public.comment_media
for select
to authenticated
using ((select private.can_view_post(post_id)));

create policy comment_media_insert_own_comment
on public.comment_media
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.comments as comment
    where comment.id = comment_media.comment_id
      and comment.post_id = comment_media.post_id
      and comment.author_id = (select auth.uid())
      and (select private.can_view_post(comment.post_id))
  )
);

create policy comment_media_delete_own_comment_or_post
on public.comment_media
for delete
to authenticated
using (
  author_id = (select auth.uid())
  or exists (
    select 1 from public.posts as post
    where post.id = post_id and post.author_id = (select auth.uid())
  )
);

create policy looply_comment_media_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'looply-media'
  and exists (
    select 1 from public.comment_media as media
    where media.storage_path = storage.objects.name
      and (select private.can_view_post(media.post_id))
  )
);

create policy looply_comment_media_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'looply-media'
  and (storage.foldername(name))[1] = 'comments'
  and private.try_uuid((storage.foldername(name))[2]) is not null
  and private.try_uuid((storage.foldername(name))[3]) is not null
  and storage.filename(name) ~ '^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|mp4|webm)$'
  and exists (
    select 1 from public.comments as comment
    where comment.id = private.try_uuid((storage.foldername(name))[3])
      and comment.post_id = private.try_uuid((storage.foldername(name))[2])
      and comment.author_id = (select auth.uid())
      and (select private.can_view_post(comment.post_id))
  )
);

create policy looply_comment_media_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'looply-media'
  and (storage.foldername(name))[1] = 'comments'
  and (
    exists (
      select 1 from public.comment_media as media
      where media.storage_path = storage.objects.name
        and (media.author_id = (select auth.uid()) or exists (
          select 1 from public.posts as post
          where post.id = media.post_id and post.author_id = (select auth.uid())
        ))
    )
    or exists (
      select 1 from public.comments as comment
      where comment.id = private.try_uuid((storage.foldername(name))[3])
        and comment.author_id = (select auth.uid())
    )
  )
);

alter publication supabase_realtime add table public.comment_media;

-- Profile pictures are private Storage objects and follow profile visibility.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'looply-avatars', 'looply-avatars', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.profiles add column avatar_path text;
alter table public.profiles add constraint profiles_avatar_path_matches_owner check (
  avatar_path is null
  or avatar_path ~ ('^avatars/' || id::text || '/[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$')
);
grant select (avatar_path) on table public.profiles to authenticated;
grant update (avatar_path) on table public.profiles to authenticated;

create policy looply_avatars_read_visible_profile
on storage.objects
for select
to authenticated
using (
  bucket_id = 'looply-avatars'
  and exists (
    select 1 from public.profiles as profile
    where profile.avatar_path = storage.objects.name
      and (profile.id = (select auth.uid()) or profile.profile_visibility in ('members', 'public'))
  )
);

create policy looply_avatars_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'looply-avatars'
  and (storage.foldername(name))[1] = 'avatars'
  and private.try_uuid((storage.foldername(name))[2]) = (select auth.uid())
  and storage.filename(name) ~ '^[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$'
);

create policy looply_avatars_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'looply-avatars'
  and (storage.foldername(name))[1] = 'avatars'
  and private.try_uuid((storage.foldername(name))[2]) = (select auth.uid())
);


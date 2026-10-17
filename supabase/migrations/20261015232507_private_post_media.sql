-- Midia sempre privada no Storage; o acesso passa pelas permissoes da publicacao.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'looply-media',
  'looply-media',
  false,
  104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  storage_path text not null unique,
  kind text not null check (kind in ('image', 'video')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')),
  byte_size bigint not null check (byte_size between 1 and 104857600),
  alt_text text not null default '',
  created_at timestamptz not null default now(),
  constraint post_media_kind_matches_mime check (
    (kind = 'image' and mime_type like 'image/%')
    or (kind = 'video' and mime_type like 'video/%')
  ),
  constraint post_media_alt_text_length check (char_length(alt_text) <= 500),
  constraint post_media_path_matches_post check (
    storage_path ~ ('^posts/' || post_id::text || '/[a-f0-9-]{36}\.(jpg|jpeg|png|webp|mp4|webm)$')
  )
);

create index post_media_post_created_idx on public.post_media (post_id, created_at);

create or replace function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $function$
begin
  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$function$;

revoke all on function private.try_uuid(text) from public, anon, authenticated;
grant execute on function private.try_uuid(text) to authenticated;

create or replace function private.validate_post_media_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform p.id from public.posts as p where p.id = new.post_id for update;

  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'looply-media'
      and object.name = new.storage_path
  ) then
    raise exception 'Uploaded media object does not exist' using errcode = '23503';
  end if;

  if (
    select count(*)
    from public.post_media as media
    where media.post_id = new.post_id
  ) >= 8 then
    raise exception 'A post can have at most 8 media files' using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.validate_post_media_object() from public, anon, authenticated;

create trigger post_media_validate_uploaded_object
before insert on public.post_media
for each row execute function private.validate_post_media_object();

alter table public.post_media enable row level security;
revoke all on table public.post_media from public, anon, authenticated;
grant select on public.post_media to authenticated;
grant insert (post_id, storage_path, kind, mime_type, byte_size, alt_text)
  on public.post_media to authenticated;
grant update (alt_text) on public.post_media to authenticated;
grant delete on public.post_media to authenticated;

create policy post_media_read_with_post
on public.post_media
for select
to authenticated
using ((select private.can_view_post(post_id)));

create policy post_media_insert_post_author
on public.post_media
for insert
to authenticated
with check (
  exists (
    select 1 from public.posts as p
    where p.id = post_id and p.author_id = (select auth.uid())
  )
);

create policy post_media_update_post_author
on public.post_media
for update
to authenticated
using (
  exists (
    select 1 from public.posts as p
    where p.id = post_id and p.author_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.posts as p
    where p.id = post_id and p.author_id = (select auth.uid())
  )
);

create policy post_media_delete_post_author
on public.post_media
for delete
to authenticated
using (
  exists (
    select 1 from public.posts as p
    where p.id = post_id and p.author_id = (select auth.uid())
  )
);

create policy looply_media_read_authorized_post
on storage.objects
for select
to authenticated
using (
  bucket_id = 'looply-media'
  and (
    exists (
      select 1 from public.post_media as media
      where media.storage_path = storage.objects.name
        and (select private.can_view_post(media.post_id))
    )
    or exists (
      select 1 from public.posts as own_post
      where own_post.id = private.try_uuid((storage.foldername(storage.objects.name))[2])
        and own_post.author_id = (select auth.uid())
    )
  )
);

create policy looply_media_insert_post_author
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'looply-media'
  and (storage.foldername(name))[1] = 'posts'
  and private.try_uuid((storage.foldername(name))[2]) is not null
  and storage.filename(name) ~ '^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|mp4|webm)$'
  and exists (
    select 1 from public.posts as p
    where p.id = private.try_uuid((storage.foldername(name))[2])
      and p.author_id = (select auth.uid())
  )
);

create policy looply_media_delete_post_author
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'looply-media'
  and (storage.foldername(name))[1] = 'posts'
  and exists (
    select 1 from public.posts as p
    where p.id = private.try_uuid((storage.foldername(name))[2])
      and p.author_id = (select auth.uid())
  )
);

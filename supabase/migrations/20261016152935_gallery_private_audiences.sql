-- Restaura controles de acesso da galeria e adiciona públicos independentes para comentários.
-- Os valores padrão preservam a visibilidade atual das mídias e dos comentários existentes.

alter table public.archive_media
  add column if not exists comment_access text not null default 'viewers';
alter table public.archive_media_comments
  add column if not exists audience text not null default 'media_viewers';

alter table public.community_gallery_media
  add column if not exists visibility text not null default 'members',
  add column if not exists comment_access text not null default 'viewers';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'archive_media_comment_access_check') then
    alter table public.archive_media add constraint archive_media_comment_access_check
      check (comment_access in ('viewers', 'selected', 'disabled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'archive_media_comments_audience_check') then
    alter table public.archive_media_comments add constraint archive_media_comments_audience_check
      check (audience in ('media_viewers', 'members', 'selected', 'author_only'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'community_gallery_visibility_check') then
    alter table public.community_gallery_media add constraint community_gallery_visibility_check
      check (visibility in ('members', 'exclusive'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'community_gallery_comment_access_check') then
    alter table public.community_gallery_media add constraint community_gallery_comment_access_check
      check (comment_access in ('viewers', 'selected', 'disabled'));
  end if;
end
$$;

create table public.archive_media_commenters (
  media_id uuid not null references public.archive_media(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (media_id, user_id)
);

create table public.archive_media_comment_recipients (
  comment_id uuid not null references public.archive_media_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table public.community_gallery_media_recipients (
  media_id uuid not null references public.community_gallery_media(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  can_view boolean not null default true,
  can_comment boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (media_id, user_id),
  constraint community_gallery_recipient_comment_needs_view check (not can_comment or can_view)
);

create table public.community_gallery_media_commenters (
  media_id uuid not null references public.community_gallery_media(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (media_id, user_id)
);

create table public.community_gallery_comments (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.community_gallery_media(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null,
  audience text not null default 'media_viewers',
  created_at timestamptz not null default now(),
  constraint community_gallery_comments_body_check
    check (char_length(btrim(body)) between 1 and 2000),
  constraint community_gallery_comments_audience_check
    check (audience in ('media_viewers', 'members', 'selected', 'author_only'))
);

create table public.community_gallery_comment_recipients (
  comment_id uuid not null references public.community_gallery_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index archive_media_commenters_user_idx on public.archive_media_commenters(user_id, media_id);
create index archive_media_comment_recipients_user_idx on public.archive_media_comment_recipients(user_id, comment_id);
create index community_gallery_media_recipients_user_idx on public.community_gallery_media_recipients(user_id, media_id);
create index community_gallery_media_commenters_user_idx on public.community_gallery_media_commenters(user_id, media_id);
create index community_gallery_comments_media_created_idx on public.community_gallery_comments(media_id, created_at);
create index community_gallery_comment_recipients_user_idx on public.community_gallery_comment_recipients(user_id, comment_id);

alter table public.archive_media_commenters enable row level security;
alter table public.archive_media_comment_recipients enable row level security;
alter table public.community_gallery_media_recipients enable row level security;
alter table public.community_gallery_media_commenters enable row level security;
alter table public.community_gallery_comments enable row level security;
alter table public.community_gallery_comment_recipients enable row level security;

revoke all on table public.archive_media_commenters, public.archive_media_comment_recipients,
  public.community_gallery_media_recipients, public.community_gallery_media_commenters,
  public.community_gallery_comments, public.community_gallery_comment_recipients
  from public, anon, authenticated;
grant select, insert, delete on table public.archive_media_commenters,
  public.archive_media_comment_recipients, public.community_gallery_media_recipients,
  public.community_gallery_media_commenters, public.community_gallery_comments,
  public.community_gallery_comment_recipients to authenticated;

create or replace function private.can_view_archive_media(p_media_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.archive_media media
    where media.id = p_media_id
      and (
        (select private.is_admin())
        or media.visibility = 'members'
        or exists (
          select 1 from public.archive_media_recipients recipient
          where recipient.media_id = media.id and recipient.user_id = (select auth.uid())
        )
      )
  );
$function$;

create or replace function private.can_manage_archive_media(p_media_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and (select private.is_admin())
    and exists (select 1 from public.archive_media media where media.id = p_media_id);
$function$;

create or replace function private.can_view_community_gallery_media(p_media_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.community_gallery_media media
    where media.id = p_media_id
      and (
        (select private.is_admin())
        or media.owner_id = (select auth.uid())
        or media.visibility = 'members'
        or exists (
          select 1 from public.community_gallery_media_recipients recipient
          where recipient.media_id = media.id and recipient.user_id = (select auth.uid()) and recipient.can_view
        )
      )
  );
$function$;

create or replace function private.can_manage_community_gallery_media(p_media_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.community_gallery_media media
    where media.id = p_media_id
      and (media.owner_id = (select auth.uid()) or (select private.is_admin()))
  );
$function$;

create or replace function private.can_comment_archive_media(p_media_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_view_archive_media(p_media_id) and exists (
    select 1 from public.archive_media media
    where media.id = p_media_id
      and (
        media.comment_access = 'viewers'
        or (media.comment_access = 'selected' and exists (
          select 1 from public.archive_media_commenters commenter
          where commenter.media_id = media.id and commenter.user_id = (select auth.uid())
        ))
      )
  );
$function$;

create or replace function private.can_comment_community_gallery_media(p_media_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_view_community_gallery_media(p_media_id) and exists (
    select 1 from public.community_gallery_media media
    where media.id = p_media_id
      and (
        media.comment_access = 'viewers'
        or (media.comment_access = 'selected' and exists (
          select 1 from public.community_gallery_media_commenters commenter
          where commenter.media_id = media.id and commenter.user_id = (select auth.uid())
        ))
      )
  );
$function$;

create or replace function private.can_manage_archive_comment(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.archive_media_comments comment_row
    where comment_row.id = p_comment_id
      and (comment_row.author_id = (select auth.uid()) or (select private.is_admin()))
  );
$function$;

create or replace function private.can_manage_community_gallery_comment(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.community_gallery_comments comment_row
    where comment_row.id = p_comment_id
      and (comment_row.author_id = (select auth.uid()) or (select private.is_admin()))
  );
$function$;

create or replace function private.can_view_archive_media_comment(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.archive_media_comments comment_row
    where comment_row.id = p_comment_id
      and (
        comment_row.author_id = (select auth.uid())
        or (select private.is_admin())
        or comment_row.audience = 'members'
        or (comment_row.audience = 'media_viewers' and private.can_view_archive_media(comment_row.media_id))
        or (comment_row.audience = 'selected' and exists (
          select 1 from public.archive_media_comment_recipients recipient
          where recipient.comment_id = comment_row.id and recipient.user_id = (select auth.uid())
        ))
      )
  );
$function$;

create or replace function private.can_view_community_gallery_comment(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.community_gallery_comments comment_row
    where comment_row.id = p_comment_id
      and (
        comment_row.author_id = (select auth.uid())
        or (select private.is_admin())
        or comment_row.audience = 'members'
        or (comment_row.audience = 'media_viewers' and private.can_view_community_gallery_media(comment_row.media_id))
        or (comment_row.audience = 'selected' and exists (
          select 1 from public.community_gallery_comment_recipients recipient
          where recipient.comment_id = comment_row.id and recipient.user_id = (select auth.uid())
        ))
      )
  );
$function$;

create or replace function private.can_view_community_gallery_media_comment(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_view_community_gallery_comment(p_comment_id);
$function$;

revoke all on function private.can_view_archive_media(uuid),
  private.can_manage_archive_media(uuid),
  private.can_view_community_gallery_media(uuid),
  private.can_manage_community_gallery_media(uuid),
  private.can_comment_archive_media(uuid),
  private.can_comment_community_gallery_media(uuid),
  private.can_manage_archive_comment(uuid),
  private.can_manage_community_gallery_comment(uuid),
  private.can_view_archive_media_comment(uuid),
  private.can_view_community_gallery_comment(uuid),
  private.can_view_community_gallery_media_comment(uuid)
  from public, anon;
grant execute on function private.can_view_archive_media(uuid),
  private.can_manage_archive_media(uuid),
  private.can_view_community_gallery_media(uuid),
  private.can_manage_community_gallery_media(uuid),
  private.can_comment_archive_media(uuid),
  private.can_comment_community_gallery_media(uuid),
  private.can_manage_archive_comment(uuid),
  private.can_manage_community_gallery_comment(uuid),
  private.can_view_archive_media_comment(uuid),
  private.can_view_community_gallery_comment(uuid),
  private.can_view_community_gallery_media_comment(uuid)
  to authenticated;

drop policy if exists archive_media_audience_read on public.archive_media;
create policy archive_media_audience_read on public.archive_media for select to authenticated
using ((select private.can_view_archive_media(id)));
drop policy if exists archive_media_admin_update on public.archive_media;
create policy archive_media_admin_update on public.archive_media for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists archive_media_recipients_owner_read on public.archive_media_recipients;
create policy archive_media_recipients_owner_read on public.archive_media_recipients for select to authenticated
using (user_id = (select auth.uid()) or (select private.can_manage_archive_media(media_id)));
create policy archive_media_recipients_admin_insert on public.archive_media_recipients for insert to authenticated
with check ((select private.can_manage_archive_media(media_id)));
create policy archive_media_recipients_admin_delete on public.archive_media_recipients for delete to authenticated
using ((select private.can_manage_archive_media(media_id)));

drop policy if exists archive_media_comments_audience_read on public.archive_media_comments;
create policy archive_media_comments_audience_read on public.archive_media_comments for select to authenticated
using ((select private.can_view_archive_media_comment(id)));
drop policy if exists archive_media_comments_author_insert on public.archive_media_comments;
create policy archive_media_comments_author_insert on public.archive_media_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.can_comment_archive_media(media_id))
  and audience in ('media_viewers', 'members', 'selected', 'author_only')
);
drop policy if exists archive_media_comments_author_delete on public.archive_media_comments;
create policy archive_media_comments_author_delete on public.archive_media_comments for delete to authenticated
using (author_id = (select auth.uid()) or (select private.is_admin()));
drop policy if exists archive_media_comments_author_update on public.archive_media_comments;
create policy archive_media_comments_author_update on public.archive_media_comments for update to authenticated
using (author_id = (select auth.uid()) or (select private.is_admin()))
with check (author_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists archive_media_commenters_admin_read on public.archive_media_commenters;
create policy archive_media_commenters_admin_read on public.archive_media_commenters for select to authenticated
using ((select private.can_manage_archive_media(media_id)));
create policy archive_media_commenters_admin_insert on public.archive_media_commenters for insert to authenticated
with check ((select private.can_manage_archive_media(media_id)));
create policy archive_media_commenters_admin_delete on public.archive_media_commenters for delete to authenticated
using ((select private.can_manage_archive_media(media_id)));

drop policy if exists archive_media_comment_recipients_read on public.archive_media_comment_recipients;
create policy archive_media_comment_recipients_read on public.archive_media_comment_recipients for select to authenticated
using (user_id = (select auth.uid()) or (select private.can_manage_archive_comment(comment_id)));
create policy archive_media_comment_recipients_author_insert on public.archive_media_comment_recipients for insert to authenticated
with check ((select private.can_manage_archive_comment(comment_id)));
create policy archive_media_comment_recipients_author_delete on public.archive_media_comment_recipients for delete to authenticated
using ((select private.can_manage_archive_comment(comment_id)));

drop policy if exists community_gallery_members_read on public.community_gallery_media;
create policy community_gallery_members_read on public.community_gallery_media for select to authenticated
using ((select private.can_view_community_gallery_media(id)));

drop policy if exists community_gallery_owner_update on public.community_gallery_media;
create policy community_gallery_owner_update on public.community_gallery_media for update to authenticated
using (owner_id = (select auth.uid()) or (select private.is_admin()))
with check (owner_id = (select auth.uid()) or (select private.is_admin()));

create policy community_gallery_recipients_read on public.community_gallery_media_recipients for select to authenticated
using (user_id = (select auth.uid()) or (select private.can_manage_community_gallery_media(media_id)));
create policy community_gallery_recipients_manage on public.community_gallery_media_recipients for all to authenticated
using ((select private.can_manage_community_gallery_media(media_id)))
with check ((select private.can_manage_community_gallery_media(media_id)));

create policy community_gallery_commenters_read on public.community_gallery_media_commenters for select to authenticated
using ((select private.can_manage_community_gallery_media(media_id)));
create policy community_gallery_commenters_manage on public.community_gallery_media_commenters for all to authenticated
using ((select private.can_manage_community_gallery_media(media_id)))
with check ((select private.can_manage_community_gallery_media(media_id)));

create policy community_gallery_comments_audience_read on public.community_gallery_comments for select to authenticated
using ((select private.can_view_community_gallery_comment(id)));
create policy community_gallery_comments_author_insert on public.community_gallery_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.can_comment_community_gallery_media(media_id))
);
create policy community_gallery_comments_author_delete on public.community_gallery_comments for delete to authenticated
using (author_id = (select auth.uid()) or (select private.is_admin()));

create policy community_gallery_comment_recipients_read on public.community_gallery_comment_recipients for select to authenticated
using (user_id = (select auth.uid()) or (select private.can_manage_community_gallery_comment(comment_id)));
create policy community_gallery_comment_recipients_manage on public.community_gallery_comment_recipients for all to authenticated
using ((select private.can_manage_community_gallery_comment(comment_id)))
with check ((select private.can_manage_community_gallery_comment(comment_id)));

drop policy if exists looply_gallery_read_registered on storage.objects;
create policy looply_gallery_read_registered on storage.objects for select to authenticated
using (
  bucket_id = 'looply-gallery'
  and exists (
    select 1 from public.community_gallery_media media
    where media.storage_path = objects.name
      and private.can_view_community_gallery_media(media.id)
  )
);

alter publication supabase_realtime add table public.community_gallery_comments;




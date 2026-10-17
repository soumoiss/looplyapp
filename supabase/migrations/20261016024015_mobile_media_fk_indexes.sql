-- Cover the referencing columns used by cascading deletes and joins.
create index comment_media_author_id_idx
  on public.comment_media (author_id);

create index comment_media_comment_post_idx
  on public.comment_media (comment_id, post_id);


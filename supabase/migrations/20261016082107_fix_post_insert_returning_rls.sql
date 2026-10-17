-- Allow an author to read the row being inserted by INSERT ... RETURNING.
-- The visibility helper queries posts; direct author ownership must not depend on
-- a same-statement self-query while PostgREST returns the newly inserted row.
drop policy if exists posts_read_visible on public.posts;

create policy posts_read_visible
on public.posts
for select
to anon, authenticated
using (
  author_id = (select auth.uid())
  or (select private.can_view_post(id))
);

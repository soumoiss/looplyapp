-- A RPC de compartilhamento roda com os privilégios do usuário e continua sujeita a RLS.
alter function public.create_selected_post(text, uuid[]) security invoker;

drop policy if exists posts_insert_own_public_or_private on public.posts;
create policy posts_insert_own
on public.posts
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and visibility in ('public', 'private', 'selected')
);

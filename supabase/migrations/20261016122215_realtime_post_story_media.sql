-- Publish media metadata changes so authorized subscribers refresh their media lists.
do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_media'
    ) then
      execute 'alter publication supabase_realtime add table public.post_media';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'story_media'
    ) then
      execute 'alter publication supabase_realtime add table public.story_media';
    end if;
  end if;
end;
$publication$;

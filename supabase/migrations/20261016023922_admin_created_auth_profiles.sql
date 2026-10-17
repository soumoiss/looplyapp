-- Administrative Auth creation derives identity only from the reserved email address.
-- Supabase generates the Auth UUID; an email on another domain or outside the allowlist is rejected.

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  requested_username text;
  requested_display_name text;
begin
  requested_username := lower(trim(split_part(coalesce(new.email, ''), '@', 1)));
  requested_display_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  if new.email is null
    or new.email !~* '^[a-z0-9_]{3,30}@loooply\.app$'
    or requested_username !~ '^[a-z0-9_]{3,30}$'
    or requested_username not in ('patati', 'misol', 'yara', 'peixinho') then
    raise exception 'Auth user email must match an approved Looply identity';
  end if;

  if char_length(requested_display_name) = 0 then
    requested_display_name := case requested_username
      when 'patati' then 'Patati'
      when 'misol' then 'Misol'
      when 'yara' then 'Yara'
      when 'peixinho' then 'Peixinho'
      else requested_username
    end;
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, requested_username, left(requested_display_name, 80));

  -- Profile metadata is not used to grant administrative privileges.
  return new;
end;
$function$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;


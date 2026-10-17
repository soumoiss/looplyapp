-- Usernames are confirmed account identities in this four-member instance.
revoke update (username) on table public.profiles from authenticated;

create or replace function private.prevent_profile_username_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.username is distinct from old.username then
    raise exception 'Confirmed username cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function private.prevent_profile_username_change() from public, anon, authenticated;

create trigger profiles_prevent_username_change
before update of username on public.profiles
for each row execute function private.prevent_profile_username_change();

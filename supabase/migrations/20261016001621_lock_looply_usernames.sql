-- The new Looply instance is reserved for the four user-confirmed accounts.
-- Admin privileges remain independently granted through private.admin_users.
alter table public.profiles
  add constraint profiles_username_allowlist
  check (username in ('patati', 'misol', 'yara', 'peixinho'));

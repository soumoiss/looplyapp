-- Mantém a associação administrativa inacessível a clientes e indexa a FK de auditoria.
create index admin_users_granted_by_idx
  on private.admin_users (granted_by)
  where granted_by is not null;

create policy admin_users_deny_direct_access
on private.admin_users
for all
to authenticated
using (false)
with check (false);

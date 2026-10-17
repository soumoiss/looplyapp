-- A trilha permanece inacessível por tabela; somente as funções de auditoria a usam.
create policy admin_audit_deny_direct_access
on private.admin_audit
for all
to public
using (false)
with check (false);

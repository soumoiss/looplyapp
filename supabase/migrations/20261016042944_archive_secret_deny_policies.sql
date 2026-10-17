-- Private card material is accessed only inside service-role-only security-definer RPCs.
create policy archived_card_secrets_deny_direct_access
on private.archived_card_secrets for all to public
using (false)
with check (false);

create policy archived_card_unlock_attempts_deny_direct_access
on private.archived_card_unlock_attempts for all to public
using (false)
with check (false);


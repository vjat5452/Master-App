// sourceOfChange: USER (default), ADMIN, CSV_IMPORT or SYSTEM.
export async function writeAudit(client, { actorUserId, companyId = null, action, entityType, entityId = null, before = null, after = null, sourceOfChange = 'USER' }) {
  await client.query(
    `INSERT INTO audit_logs (actor_user_id, company_id, action, entity_type, entity_id, before, after, source_of_change)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [actorUserId, companyId, action, entityType, entityId, before && JSON.stringify(before), after && JSON.stringify(after), sourceOfChange],
  );
}

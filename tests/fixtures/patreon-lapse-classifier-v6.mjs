// Extracted from the read-only deployed version 6 capture on 2026-11-08.
// Historical regression fixture only; the active report is in supabase/functions/_shared/.
export function findLapsedServers(owners, patrons) {
  const lapsed = [];
  for (const owner of owners){
    if (owner.accountId === null) lapsed.push({
      ...owner,
      reason: "owner has no website account"
    });
    else if (owner.patreonUserId === null) lapsed.push({
      ...owner,
      reason: "no Patreon account linked"
    });
    else if (!patrons.has(owner.patreonUserId)) lapsed.push({
      ...owner,
      reason: "not an active $20+ patron"
    });
  }
  return lapsed;
}

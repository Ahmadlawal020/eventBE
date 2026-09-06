const addPeriod = (date, period) => {
  const result = new Date(date);
  if (period.value === 0) return null; // Legacy unlimited earning periods.
  if (period.unit === "MONTHS") {
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + period.value);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
  } else {
    result.setUTCDate(result.getUTCDate() + period.value * (period.unit === "WEEKS" ? 7 : 1));
  }
  return result;
};
const revisionAt = (policy, at) => policy.revisions
  .filter(r => new Date(r.effectiveAt) <= at)
  .sort((a,b) => b.version - a.version)[0];
const resolvePolicy = (policies, userId, at = new Date()) => {
  const available = policies.map(p => ({ ...p, rule: revisionAt(p, at) })).filter(p => p.rule);
  const global = available.find(p => p.scope === "GLOBAL");
  if (!global) throw new Error("Global referral policy is missing");
  const groups = available.filter(p => p.scope === "GROUP" && p.rule.userIds.some(id => String(id) === String(userId)))
    .sort((a,b) => a.rule.priority - b.rule.priority || new Date(a.rule.effectiveAt) - new Date(b.rule.effectiveAt) || a.key.localeCompare(b.key));
  const individual = available.find(p => p.scope === "USER" && String(p.targetUser) === String(userId));
  const matched = [global, ...groups, ...(individual ? [individual] : [])];
  const result = { policyVersions: [], status: "ACTIVE", startedAt: null };
  for (const policy of matched) {
    const r = policy.rule;
    result.policyVersions.push({ key: policy.key, version: r.version });
    if (r.commissionPercentage !== null && r.commissionPercentage !== undefined) result.commissionPercentage = r.commissionPercentage;
    if (r.duration) result.duration = r.duration;
    if (r.entryWindow && policy.scope === "GLOBAL") result.entryWindow = r.entryWindow;
    if (r.status !== "INHERIT") result.status = r.status;
    if (r.startedAt && (!result.startedAt || new Date(r.startedAt) > new Date(result.startedAt))) result.startedAt = r.startedAt;
  }
  // A global stop always gates every individual/group override.
  if (global.rule.status !== "ACTIVE") result.status = global.rule.status;
  return result;
};
module.exports = { addPeriod, revisionAt, resolvePolicy };

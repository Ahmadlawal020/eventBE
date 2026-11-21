const fields = new Set(["allowGuestCancellation", "noticeHours", "noticeUnit", "allowGuestReschedule", "rescheduleApprovalRequired", "rescheduleNoticeHours", "rescheduleNoticeUnit", "maxReschedules", "refundMinDays", "refundDays", "refundInstructions"]);
function mergePolicyUpdate(venue, patch, expectedUpdatedAt) {
  const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(key => !fields.has(key)))
    fail("Use valid cancellation, rescheduling or refund fields.", 400);
  if (!expectedUpdatedAt || +new Date(expectedUpdatedAt) !== +new Date(venue.updatedAt))
    fail("This listing changed since you started editing. Reload its latest settings before saving your policy.", 409);
  return { ...(venue.cancellationPolicy?.toObject?.() || venue.cancellationPolicy || {}), ...patch };
}
module.exports = { mergePolicyUpdate };

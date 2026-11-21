exports.canViewListing = (listing, user) => {
  const isPubliclyVisible =
    listing.status === "LISTED" &&
    !listing.archivedAt &&
    !["UNLISTED", "CANCELLED"].includes(listing.moderation?.status);
  if (isPubliclyVisible) return true;
  if (!user?.id) return false;
  if ((user.roles || []).some(role => ["admin", "superadmin", "super_admin", "moderator"].includes(role))) return true;
  if (listing.archivedAt) return false;
  return [listing.createdBy, ...(listing.coOrganisers || []), ...(listing.staff || [])]
    .some(person => person && String(person._id || person) === String(user.id));
};

exports.canViewListing = (listing, user) => {
  if (listing.status === "LISTED") return true;
  if (!user?.id) return false;
  if ((user.roles || []).some(role => ["admin", "superadmin", "super_admin", "moderator", "modarator"].includes(role))) return true;
  return [listing.createdBy, ...(listing.coOrganisers || []), ...(listing.staff || [])]
    .some(person => person && String(person._id || person) === String(user.id));
};

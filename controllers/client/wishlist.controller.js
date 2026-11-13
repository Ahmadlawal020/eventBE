const User = require("../../models/client/user.schema");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const asyncHandler = require("express-async-handler");

/**
 * @desc    Toggle Event in Wishlist
 * @route   POST /api/v1/user/wishlist/events/:id
 * @access  Private
 */
// Wishlist state, public counter and trusted learning evidence commit together.
const toggle = (entityType, field, Model) => asyncHandler(async (req, res) => {
  const mongoose = require("mongoose");
  const id = req.params.id;
  if (!mongoose.isObjectIdOrHexString(id)) return res.status(400).json({ success:false, message:"Invalid listing." });
  try {
    const result = await mongoose.connection.transaction(async session => {
      const user = await User.findById(req.user.id).session(session);
      if (!user) throw Object.assign(Error("User not found"),{ statusCode:404 });
      const removing = user[field].some(value => String(value) === id);
      const listing = await Model.findById(id).select("status archivedAt moderation.status").session(session);
      if (!removing && !require("../../services/discoveryPolicy.service").publicListing(listing))
        throw Object.assign(Error("Listing is unavailable"),{ statusCode:404 });
      if (removing) user[field] = user[field].filter(value => String(value) !== id);
      else user[field].push(id);
      await user.save({ session });
      if (listing) await Model.updateOne({ _id:id },[
        { $set:{ "performance.wishlists":{ $max:[0,{ $add:[{ $ifNull:["$performance.wishlists",0] },removing ? -1 : 1] }] } } }
      ],{ session });
      if (!removing) await require("../../services/discovery.service").recordSave(req.user.id,entityType,id,session);
      return { removing, ids:user[field] };
    });
    res.json({ success:true, message:result.removing ? "Removed from wishlist" : "Added to wishlist", data:{ [field]:result.ids } });
  } catch (error) {
    if (error.statusCode) res.status(error.statusCode);
    throw error;
  }
});
const toggleWishlistEvent = toggle("Event","wishlistEvents",Event);
const toggleWishlistEventCenter = toggle("EventCenter","wishlistEventCenters",EventCenter);

/**
 * @desc    Get User Wishlist
 * @route   GET /api/v1/user/wishlist
 * @access  Private
 */
const getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id)
    .populate({
      path: "wishlistEvents",
      select: "title shortDescription images location schedule eventType status",
      match: { status: "LISTED" }
    })
    .populate({
      path: "wishlistEventCenters",
      select: "venueName images location capacity venueType",
    });

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  res.status(200).json({
    success: true,
    data: {
      events: user.wishlistEvents,
      eventCenters: user.wishlistEventCenters
    }
  });
});

module.exports = {
  toggleWishlistEvent,
  toggleWishlistEventCenter,
  getWishlist
};

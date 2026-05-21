const User = require("../../models/user/user.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const asyncHandler = require("express-async-handler");

/**
 * @desc    Toggle Event in Wishlist
 * @route   POST /api/v1/user/wishlist/events/:id
 * @access  Private
 */
const toggleWishlistEvent = asyncHandler(async (req, res) => {
  const eventId = req.params.id;
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const isWishlisted = user.wishlistEvents.includes(eventId);

  if (isWishlisted) {
    user.wishlistEvents = user.wishlistEvents.filter(id => id.toString() !== eventId);
  } else {
    user.wishlistEvents.push(eventId);
  }

  await user.save();

  // Update wishlist counter on the listing
  await Event.findByIdAndUpdate(eventId, {
    $inc: { "performance.wishlists": isWishlisted ? -1 : 1 },
  });

  res.status(200).json({
    success: true,
    message: isWishlisted ? "Removed from wishlist" : "Added to wishlist",
    data: {
      wishlistEvents: user.wishlistEvents
    }
  });
});

/**
 * @desc    Toggle Event Center in Wishlist
 * @route   POST /api/v1/user/wishlist/event-centers/:id
 * @access  Private
 */
const toggleWishlistEventCenter = asyncHandler(async (req, res) => {
  const centerId = req.params.id;
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const isWishlisted = user.wishlistEventCenters.includes(centerId);

  if (isWishlisted) {
    user.wishlistEventCenters = user.wishlistEventCenters.filter(id => id.toString() !== centerId);
  } else {
    user.wishlistEventCenters.push(centerId);
  }

  await user.save();

  // Update wishlist counter on the listing
  await EventCenter.findByIdAndUpdate(centerId, {
    $inc: { "performance.wishlists": isWishlisted ? -1 : 1 },
  });

  res.status(200).json({
    success: true,
    message: isWishlisted ? "Removed from wishlist" : "Added to wishlist",
    data: {
      wishlistEventCenters: user.wishlistEventCenters
    }
  });
});

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

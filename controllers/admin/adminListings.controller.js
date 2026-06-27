const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const { recordAdminAction } = require("../../services/admin/adminAudit.service");

const LISTING_MODELS = {
  event: {
    model: Event,
    targetType: "Event",
    titleField: "title",
    populate: "createdBy",
  },
  "event-center": {
    model: EventCenter,
    targetType: "EventCenter",
    titleField: "venueName",
    populate: "createdBy",
  },
};

const getListings = async (req, res) => {
  try {
    const { type = "all", status, search, page = 1, limit = 20 } = req.query;
    const requestedTypes = type === "all" ? ["event", "event-center"] : [type];
    const skip = (Number(page) - 1) * Number(limit);

    const results = await Promise.all(
      requestedTypes
        .filter((item) => LISTING_MODELS[item])
        .map(async (listingType) => {
          const config = LISTING_MODELS[listingType];
          const query = {};

          if (status) query.status = status;
          if (search) query[config.titleField] = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

          const [items, total] = await Promise.all([
            config.model
              .find(query)
              .populate(config.populate, "firstName surname email")
              .select(`${config.titleField} status images location performance createdBy createdAt updatedAt`)
              .sort({ createdAt: -1 })
              .skip(type === "all" ? 0 : skip)
              .limit(type === "all" ? Number(limit) : Number(limit))
              .lean(),
            config.model.countDocuments(query),
          ]);

          return {
            type: listingType,
            total,
            items: items.map((item) => ({
              ...item,
              listingType,
              displayName: item[config.titleField],
            })),
          };
        }),
    );

    const listings = results.flatMap((result) => result.items).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = results.reduce((sum, result) => sum + result.total, 0);

    res.status(200).json({
      success: true,
      data: {
        listings: listings.slice(0, Number(limit)),
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET LISTINGS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching listings" });
  }
};

const getListingDetails = async (req, res) => {
  try {
    const { type, id } = req.params;
    const config = LISTING_MODELS[type];

    if (!config) {
      return res.status(400).json({ success: false, message: "Invalid listing type" });
    }

    const listing = await config.model
      .findById(id)
      .populate("createdBy", "firstName surname email phoneNumber roles isActive")
      .populate("coOrganisers", "firstName surname email")
      .populate("staff", "firstName surname email")
      .lean();

    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found" });
    }

    res.status(200).json({
      success: true,
      data: {
        listing: {
          ...listing,
          listingType: type,
          displayName: listing[config.titleField],
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET LISTING DETAILS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching listing details" });
  }
};

const updateListingStatus = async (req, res) => {
  try {
    const { type, id } = req.params;
    const { status, reason } = req.body;
    const config = LISTING_MODELS[type];

    if (!config) {
      return res.status(400).json({ success: false, message: "Invalid listing type" });
    }

    if (!["IN_PROGRESS", "ACTION_REQUIRED", "LISTED", "UNLISTED"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid listing status" });
    }

    const listing = await config.model.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found" });
    }

    const previousValue = { status: listing.status };
    listing.status = status;
    await listing.save();

    await recordAdminAction({
      req,
      action: "LISTING_STATUS_UPDATED",
      targetType: config.targetType,
      targetId: listing._id,
      previousValue,
      newValue: { status },
      metadata: { reason, listingType: type },
    });

    res.status(200).json({
      success: true,
      message: "Listing status updated",
      data: { id: listing._id, status: listing.status },
    });
  } catch (error) {
    console.error("[ADMIN UPDATE LISTING STATUS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error updating listing status" });
  }
};

module.exports = {
  getListings,
  getListingDetails,
  updateListingStatus,
};

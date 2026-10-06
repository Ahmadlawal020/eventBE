const mongoose = require("mongoose");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const User = require("../../models/client/user.schema");
const {
  recordAdminAction,
} = require("../../services/management/adminAudit.service");
const geo = require("../../services/management/geography.service");

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
    const {
      type = "all",
      status,
      search,
      eventType,
      venueType,
      timing,
      sort = "newest",
      page = 1,
      limit = 20,
    } = req.query;

    const workingLocation = req.query.location || req.headers["x-working-location"];
    let geoFilter = {};
    try {
      geoFilter = await geo.recordFilter(req.managementStaff, workingLocation, "records.read");
    } catch (err) {
      return res.status(err.status || 403).json({ success: false, message: err.message });
    }

    const requestedTypes = type === "all" ? ["event", "event-center"] : [type];
    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNumber - 1) * limitNumber;
    const searchExpression = search
      ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      : null;
    const matchingCreators = searchExpression
      ? await User.find({
        $or: [
          { firstName: searchExpression },
          { surname: searchExpression },
          { email: searchExpression },
        ],
      })
        .select("_id")
        .limit(250)
        .lean()
      : [];
    const matchingCreatorIds = matchingCreators.map((creator) => creator._id);

    const geoMatch = geoFilter.managementLocation ? [{ $match: geoFilter }] : [];

    const eventMetricsPromise = requestedTypes.includes("event")
      ? Event.aggregate([
        ...geoMatch,
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  listed: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "LISTED"] }, 1, 0],
                    },
                  },
                  actionRequired: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "ACTION_REQUIRED"] }, 1, 0],
                    },
                  },
                  inProgress: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "IN_PROGRESS"] }, 1, 0],
                    },
                  },
                  unlisted: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "UNLISTED"] }, 1, 0],
                    },
                  },
                  completed: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0],
                    },
                  },
                  upcoming: {
                    $sum: {
                      $cond: [{ $gte: ["$schedule.to", new Date()] }, 1, 0],
                    },
                  },
                  past: {
                    $sum: {
                      $cond: [{ $lt: ["$schedule.to", new Date()] }, 1, 0],
                    },
                  },
                  capacity: { $sum: { $ifNull: ["$capacity", 0] } },
                  views: { $sum: { $ifNull: ["$performance.views", 0] } },
                  clicks: {
                    $sum: { $ifNull: ["$performance.clicks", 0] },
                  },
                  wishlists: {
                    $sum: { $ifNull: ["$performance.wishlists", 0] },
                  },
                  reach: { $sum: { $ifNull: ["$performance.reach", 0] } },
                  shares: {
                    $sum: { $ifNull: ["$performance.shares", 0] },
                  },
                  ticketSales: {
                    $sum: { $ifNull: ["$performance.ticketSales", 0] },
                  },
                  revenue: {
                    $sum: { $ifNull: ["$performance.revenue", 0] },
                  },
                },
              },
            ],
            categories: [
              { $match: { eventType: { $exists: true, $ne: null } } },
              { $group: { _id: "$eventType", count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
              { $limit: 8 },
            ],
          },
        },
      ])
      : Promise.resolve([]);

    const venueMetricsPromise = requestedTypes.includes("event-center")
      ? EventCenter.aggregate([
        ...geoMatch,
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  listed: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "LISTED"] }, 1, 0],
                    },
                  },
                  actionRequired: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "ACTION_REQUIRED"] }, 1, 0],
                    },
                  },
                  inProgress: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "IN_PROGRESS"] }, 1, 0],
                    },
                  },
                  unlisted: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "UNLISTED"] }, 1, 0],
                    },
                  },
                  instantBooking: {
                    $sum: {
                      $cond: [{ $eq: ["$bookingSettings", "INSTANT"] }, 1, 0],
                    },
                  },
                  reviewBooking: {
                    $sum: {
                      $cond: [{ $eq: ["$bookingSettings", "REVIEW"] }, 1, 0],
                    },
                  },
                  totalCapacity: {
                    $sum: { $ifNull: ["$capacity.max", 0] },
                  },
                  views: {
                    $sum: { $ifNull: ["$performance.views", 0] },
                  },
                  clicks: {
                    $sum: { $ifNull: ["$performance.clicks", 0] },
                  },
                  reach: {
                    $sum: { $ifNull: ["$performance.reach", 0] },
                  },
                  wishlists: {
                    $sum: { $ifNull: ["$performance.wishlists", 0] },
                  },
                  shares: {
                    $sum: { $ifNull: ["$performance.shares", 0] },
                  },
                  pendingInquiries: {
                    $sum: {
                      $ifNull: ["$performance.pendingInquiries", 0],
                    },
                  },
                  bookings: {
                    $sum: { $ifNull: ["$performance.bookings", 0] },
                  },
                  revenue: {
                    $sum: { $ifNull: ["$performance.revenue", 0] },
                  },
                },
              },
            ],
            categories: [
              { $match: { venueType: { $exists: true, $ne: null } } },
              { $group: { _id: "$venueType", count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
              { $limit: 8 },
            ],
          },
        },
      ])
      : Promise.resolve([]);

    const [results, eventMetricRows, venueMetricRows] = await Promise.all([
      Promise.all(
        requestedTypes
          .filter((item) => LISTING_MODELS[item])
          .map(async (listingType) => {
            const config = LISTING_MODELS[listingType];
            const query = { ...geoFilter };

            if (status) query.status = status;
            if (searchExpression) {
              query.$or = [
                { [config.titleField]: searchExpression },
                { shortDescription: searchExpression },
                { "location.addressString": searchExpression },
                { "location.area": searchExpression },
                { "location.city": searchExpression },
                { "location.country": searchExpression },
                { createdBy: { $in: matchingCreatorIds } },
              ];
            }

            if (listingType === "event") {
              if (eventType) query.eventType = eventType;
              if (timing === "upcoming")
                query["schedule.to"] = { $gte: new Date() };
              if (timing === "past") query["schedule.to"] = { $lt: new Date() };
            }
            if (listingType === "event-center" && venueType) {
              query.venueType = venueType;
            }

            const sortOptions = {
              newest: { createdAt: -1 },
              oldest: { createdAt: 1 },
              start_soon:
                listingType === "event"
                  ? { "schedule.from": 1 }
                  : { createdAt: -1 },
              title: { [config.titleField]: 1 },
              capacity:
                listingType === "event-center"
                  ? { "capacity.max": -1 }
                  : { createdAt: -1 },
              most_viewed: { "performance.views": -1 },
              most_engaged: { "performance.engagement": -1 },
              most_sold: { "performance.ticketSales": -1 },
              most_booked:
                listingType === "event-center"
                  ? { "performance.bookings": -1 }
                  : { createdAt: -1 },
            };

            const [items, total] = await Promise.all([
              config.model
                .find(query)
                .populate(config.populate, "firstName surname email")
                .select(
                  `${config.titleField} shortDescription status images eventType venueType schedule location capacity totalArea basePrice weekendPrice bookingSettings amenities supportedEvents safety availability entry performance createdBy createdAt updatedAt`,
                )
                .sort(sortOptions[sort] || sortOptions.newest)
                .skip(type === "all" ? 0 : skip)
                .limit(limitNumber)
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
      ),
      eventMetricsPromise,
      venueMetricsPromise,
    ]);

    const listings = results.flatMap((result) => result.items);
    const total = results.reduce((sum, result) => sum + result.total, 0);
    const eventMetricFacet = eventMetricRows[0] || {};
    const eventMetrics = eventMetricFacet.summary?.[0] || {};
    const venueMetricFacet = venueMetricRows[0] || {};
    const venueMetrics = venueMetricFacet.summary?.[0] || {};

    const dataRestrictions = req.managementStaff?.dataRestrictions || [];
    if (
      dataRestrictions.includes("attendee_pii") ||
      dataRestrictions.includes("identity_documents")
    ) {
      for (const item of listings) {
        if (item.createdBy && typeof item.createdBy === "object") {
          item.createdBy.email = "[Restricted]";
          item.createdBy.phoneNumber = "[Restricted]";
        }
      }
    }
    if (dataRestrictions.includes("financial_data")) {
      for (const item of listings) {
        if (item.performance) {
          item.performance.revenue = 0;
          item.performance.ticketSales = 0;
        }
      }
      if (eventMetrics) {
        eventMetrics.revenue = 0;
        eventMetrics.ticketSales = 0;
      }
      if (venueMetrics) {
        venueMetrics.revenue = 0;
        venueMetrics.bookings = 0;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        listings: listings.slice(0, limitNumber),
        metrics: {
          events: {
            total: eventMetrics.total || 0,
            listed: eventMetrics.listed || 0,
            actionRequired: eventMetrics.actionRequired || 0,
            inProgress: eventMetrics.inProgress || 0,
            unlisted: eventMetrics.unlisted || 0,
            completed: eventMetrics.completed || 0,
            upcoming: eventMetrics.upcoming || 0,
            past: eventMetrics.past || 0,
            capacity: eventMetrics.capacity || 0,
            views: eventMetrics.views || 0,
            clicks: eventMetrics.clicks || 0,
            wishlists: eventMetrics.wishlists || 0,
            reach: eventMetrics.reach || 0,
            shares: eventMetrics.shares || 0,
            ticketSales: eventMetrics.ticketSales || 0,
            revenue: eventMetrics.revenue || 0,
            categories: eventMetricFacet.categories || [],
          },
          eventCenters: {
            total: venueMetrics.total || 0,
            listed: venueMetrics.listed || 0,
            actionRequired: venueMetrics.actionRequired || 0,
            inProgress: venueMetrics.inProgress || 0,
            unlisted: venueMetrics.unlisted || 0,
            instantBooking: venueMetrics.instantBooking || 0,
            reviewBooking: venueMetrics.reviewBooking || 0,
            totalCapacity: venueMetrics.totalCapacity || 0,
            views: venueMetrics.views || 0,
            clicks: venueMetrics.clicks || 0,
            reach: venueMetrics.reach || 0,
            wishlists: venueMetrics.wishlists || 0,
            shares: venueMetrics.shares || 0,
            pendingInquiries: venueMetrics.pendingInquiries || 0,
            bookings: venueMetrics.bookings || 0,
            revenue: venueMetrics.revenue || 0,
            categories: venueMetricFacet.categories || [],
          },
        },
        pagination: {
          total,
          page: pageNumber,
          pages: Math.ceil(total / limitNumber),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET LISTINGS ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching listings" });
  }
};

const getListingDetails = async (req, res) => {
  try {
    const { type, id } = req.params;
    const config = LISTING_MODELS[type];

    if (!config) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid listing type" });
    }
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid listing ID" });
    }

    const listing = await config.model
      .findById(id)
      .populate(
        "createdBy",
        "firstName surname email phoneNumber roles isActive",
      )
      .populate("coOrganisers", "firstName surname email")
      .populate("staff", "firstName surname email")
      .lean();

    if (!listing) {
      return res
        .status(404)
        .json({ success: false, message: "Listing not found" });
    }

    if (!geo.isGlobal(req.managementStaff)) {
      const allowed = await geo.locationsFor(req.managementStaff, "records.read");
      const allowedIds = new Set(allowed.map((l) => String(l._id)));
      if (
        !listing.managementLocation ||
        !allowedIds.has(String(listing.managementLocation))
      ) {
        return res.status(404).json({
          success: false,
          message: "Listing not found or not accessible in your region",
        });
      }
    }

    const dataRestrictions = req.managementStaff?.dataRestrictions || [];
    if (
      dataRestrictions.includes("attendee_pii") ||
      dataRestrictions.includes("identity_documents")
    ) {
      if (listing.createdBy && typeof listing.createdBy === "object") {
        listing.createdBy.email = "[Restricted]";
        listing.createdBy.phoneNumber = "[Restricted]";
      }
      if (Array.isArray(listing.coOrganisers)) {
        listing.coOrganisers.forEach((co) => {
          if (co && typeof co === "object") co.email = "[Restricted]";
        });
      }
      if (Array.isArray(listing.staff)) {
        listing.staff.forEach((st) => {
          if (st && typeof st === "object") st.email = "[Restricted]";
        });
      }
    }
    if (dataRestrictions.includes("financial_data")) {
      if (listing.performance) {
        listing.performance.revenue = 0;
        listing.performance.ticketSales = 0;
      }
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
    res.status(500).json({
      success: false,
      message: "Server error fetching listing details",
    });
  }
};

const updateListingStatus = async (req, res, next) => {
  try {
    const { type, id } = req.params;
    const { status, reason } = req.body;
    const config = LISTING_MODELS[type];

    if (!config) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid listing type" });
    }

    if (
      !["IN_PROGRESS", "ACTION_REQUIRED", "LISTED", "UNLISTED"].includes(status)
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid listing status" });
    }

    const listing = await config.model.findById(id);
    if (!listing) {
      return res
        .status(404)
        .json({ success: false, message: "Listing not found" });
    }

    if (!geo.isGlobal(req.managementStaff)) {
      const allowed = await geo.locationsFor(req.managementStaff, "records.unlist");
      const allowedIds = new Set(allowed.map((l) => String(l._id)));
      if (
        !listing.managementLocation ||
        !allowedIds.has(String(listing.managementLocation))
      ) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to moderate listings for this location",
        });
      }
    }

    if (status === "LISTED" || status === "UNLISTED") {
      req.body = {
        decision: status === "LISTED" ? "APPROVED" : "UNLISTED",
        reason: reason || "",
        updatedAt: req.body.updatedAt || listing.updatedAt.toISOString(),
      };
      return require("./moderation.controller").decide(req, res, next);
    }

    const previousValue = { status: listing.status };
    const updated = await config.model.findOneAndUpdate(
      { _id: listing._id, updatedAt: listing.updatedAt },
      { $set: { status } },
      { new: true, runValidators: true },
    );
    if (!updated) return res.status(409).json({ success: false, message: "Listing changed or was removed by a moderator. Reload and use content moderation to restore it." });
    listing.status = updated.status;

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
    res.status(500).json({
      success: false,
      message: "Server error updating listing status",
    });
  }
};

const EVENT_ALLOWED_FIELDS = [
  "title",
  "shortDescription",
  "description",
  "eventType",
  "ageRestriction",
  "schedule",
  "location",
  "capacity",
  "highlights",
  "amenities",
  "safety",
  "entry",
];

const VENUE_ALLOWED_FIELDS = [
  "venueName",
  "shortDescription",
  "description",
  "venueType",
  "location",
  "capacity",
  "totalArea",
  "amenities",
  "supportedEvents",
  "basePrice",
  "weekendPrice",
  "venueRules",
  "customVenueRules",
  "safety",
  "safetyConsiderations",
  "bookingSettings",
  "checkIn",
  "checkOut",
];

const updateListing = async (req, res) => {
  try {
    const { type, id } = req.params;
    const config = LISTING_MODELS[type];

    if (!config) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid listing type" });
    }

    const listing = await config.model.findById(id);
    if (!listing) {
      return res
        .status(404)
        .json({ success: false, message: "Listing not found" });
    }

    if (!geo.isGlobal(req.managementStaff)) {
      const allowed = await geo.locationsFor(req.managementStaff, "settings.write");
      const allowedIds = new Set(allowed.map((l) => String(l._id)));
      if (
        !listing.managementLocation ||
        !allowedIds.has(String(listing.managementLocation))
      ) {
        return res.status(403).json({
          success: false,
          message: "You do not have edit permission for this location",
        });
      }
    }

    const allowedFields =
      type === "event" ? EVENT_ALLOWED_FIELDS : VENUE_ALLOWED_FIELDS;
    const previousValue = {};
    const newValue = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        previousValue[field] = listing[field];
        listing[field] = req.body[field];
        newValue[field] = req.body[field];
      }
    }

    if (Object.keys(newValue).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No valid fields to update" });
    }

    await listing.save();

    await recordAdminAction({
      req,
      action: "LISTING_DETAILS_UPDATED",
      targetType: config.targetType,
      targetId: listing._id,
      previousValue,
      newValue,
      metadata: { listingType: type },
    });

    res.status(200).json({
      success: true,
      message: "Listing updated successfully",
      data: { id: listing._id },
    });
  } catch (error) {
    console.error("[ADMIN UPDATE LISTING ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error updating listing" });
  }
};

module.exports = {
  getListings,
  getListingDetails,
  updateListingStatus,
  updateListing,
};

const mongoose = require("mongoose");
const CoOrganiserInvitation = require("../../models/client/coOrganiserInvitation.schema");
const StaffInvitation = require("../../models/client/staffInvitation.schema");
const StaffActivity = require("../../models/client/staffActivity.schema");
const User = require("../../models/client/user.schema");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");

const PERSON_FIELDS =
  "firstName surname email phoneNumber profilePicture createdAt";
const LISTING_FIELDS =
  "title venueName status images location schedule createdBy";

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normaliseView = (value) =>
  value === "staff" ? "staff" : "co-organisers";

const positiveInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return maximum ? Math.min(parsed, maximum) : parsed;
};

const getSummary = async (Model, includeExpired = false, listingType) => {
  const now = new Date();
  const pipeline = [];
  if (listingType && ["Event", "EventCenter"].includes(listingType)) {
    pipeline.push({ $match: { "listings.listingType": listingType } });
  }
  pipeline.push({
    $group: {
      _id: null,
      total: { $sum: 1 },
      accepted: { $sum: { $cond: [{ $eq: ["$status", "ACCEPTED"] }, 1, 0] } },
      pending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } },
      declined: { $sum: { $cond: [{ $eq: ["$status", "DECLINED"] }, 1, 0] } },
      left: { $sum: { $cond: [{ $eq: ["$status", "LEFT"] }, 1, 0] } },
      assignments:
        listingType && ["Event", "EventCenter"].includes(listingType)
          ? {
              $sum: {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$listings", []] },
                    as: "l",
                    cond: { $eq: ["$$l.listingType", listingType] },
                  },
                },
              },
            }
          : { $sum: { $size: { $ifNull: ["$listings", []] } } },
      ...(includeExpired
        ? {
            expired: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$status", "PENDING"] },
                      { $lt: ["$expiresAt", now] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          }
        : {}),
    },
  });

  const [result = {}] = await Model.aggregate(pipeline);

  return {
    total: result.total || 0,
    accepted: result.accepted || 0,
    pending: result.pending || 0,
    declined: result.declined || 0,
    left: result.left || 0,
    assignments: result.assignments || 0,
    expired: result.expired || 0,
  };
};

const buildSearchQuery = async ({ view, status, listingType, search }) => {
  const query = {};
  const validStatuses =
    view === "staff"
      ? ["PENDING", "ACCEPTED", "DECLINED", "LEFT"]
      : ["PENDING", "ACCEPTED", "DECLINED"];

  if (validStatuses.includes(status)) query.status = status;
  if (["Event", "EventCenter"].includes(listingType)) {
    query["listings.listingType"] = listingType;
  }

  const term = typeof search === "string" ? search.trim() : "";
  if (!term) return query;

  const regex = new RegExp(escapeRegex(term), "i");
  const [people, events, eventCenters] = await Promise.all([
    User.find({
      $or: [{ firstName: regex }, { surname: regex }, { email: regex }],
    })
      .select("_id")
      .limit(250)
      .lean(),
    Event.find({ title: regex }).select("_id").limit(250).lean(),
    EventCenter.find({ venueName: regex }).select("_id").limit(250).lean(),
  ]);

  const peopleIds = people.map((person) => person._id);
  const listingIds = [...events, ...eventCenters].map((listing) => listing._id);

  query.$or =
    view === "staff"
      ? [
          { staffEmail: regex },
          { staff: { $in: peopleIds } },
          { organiser: { $in: peopleIds } },
          { "listings.listingId": { $in: listingIds } },
        ]
      : [
          { coOrganiserEmail: regex },
          { coOrganiser: { $in: peopleIds } },
          { host: { $in: peopleIds } },
          { "listings.listingId": { $in: listingIds } },
        ];

  if (mongoose.isValidObjectId(term)) query.$or.push({ _id: term });
  return query;
};

const populateListings = async (listings = []) =>
  Promise.all(
    listings.map(async (listing) => {
      const Model = listing.listingType === "Event" ? Event : EventCenter;
      const listingDetails = await Model.findById(listing.listingId)
        .select(LISTING_FIELDS)
        .populate("createdBy", PERSON_FIELDS)
        .lean();
      return { ...listing, listingDetails };
    }),
  );

const getCoOrganisers = async (req, res) => {
  try {
    const view = normaliseView(req.query.view);
    const page = positiveInteger(req.query.page, 1);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const skip = (page - 1) * limit;
    const query = await buildSearchQuery({
      view,
      status: req.query.status,
      listingType: req.query.listingType,
      search: req.query.search,
    });
    const sort =
      req.query.sort === "oldest" ? { createdAt: 1 } : { createdAt: -1 };
    const Model = view === "staff" ? StaffInvitation : CoOrganiserInvitation;
    const population =
      view === "staff"
        ? [
            { path: "organiser", select: PERSON_FIELDS },
            { path: "staff", select: PERSON_FIELDS },
          ]
        : [
            { path: "host", select: PERSON_FIELDS },
            { path: "coOrganiser", select: PERSON_FIELDS },
          ];

    const [invitations, total, coOrganiserSummary, staffSummary] =
      await Promise.all([
        Model.find(query)
          .populate(population)
          .populate("listings.listingId", LISTING_FIELDS)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Model.countDocuments(query),
        getSummary(CoOrganiserInvitation, false, req.query.listingType),
        getSummary(StaffInvitation, true, req.query.listingType),
      ]);

    const pages = Math.ceil(total / limit);

    res.status(200).json({
      success: true,
      data: {
        view,
        metrics: {
          coOrganisers: coOrganiserSummary.accepted,
          staffMembers: staffSummary.accepted,
          pendingInvitations: coOrganiserSummary.pending + staffSummary.pending,
          listingAssignments:
            coOrganiserSummary.assignments + staffSummary.assignments,
          expiredInvitations: staffSummary.expired,
          totalInvitations: coOrganiserSummary.total + staffSummary.total,
        },
        summaries: {
          coOrganisers: coOrganiserSummary,
          staff: staffSummary,
        },
        invitations,
        coOrganiserInvitations: view === "co-organisers" ? invitations : [],
        staffInvitations: view === "staff" ? invitations : [],
        pagination: { total, page, limit, pages },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET EVENT TEAM ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching event team" });
  }
};

const getCoOrganiserDetail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid team record ID" });
    }

    const requestedType = req.query.type;
    let recordType = requestedType === "staff" ? "staff" : "co-organiser";
    let invitation;

    if (recordType === "staff") {
      invitation = await StaffInvitation.findById(id)
        .populate("organiser", PERSON_FIELDS)
        .populate("staff", PERSON_FIELDS)
        .lean();
    } else {
      invitation = await CoOrganiserInvitation.findById(id)
        .populate("host", PERSON_FIELDS)
        .populate("coOrganiser", PERSON_FIELDS)
        .lean();

      if (!invitation && !requestedType) {
        recordType = "staff";
        invitation = await StaffInvitation.findById(id)
          .populate("organiser", PERSON_FIELDS)
          .populate("staff", PERSON_FIELDS)
          .lean();
      }
    }

    if (!invitation) {
      return res
        .status(404)
        .json({ success: false, message: "Event team record not found" });
    }

    invitation.listings = await populateListings(invitation.listings);
    const requestedListingType = req.query.listingType;
    if (
      requestedListingType &&
      ["Event", "EventCenter"].includes(requestedListingType)
    ) {
      invitation.listings = invitation.listings.filter(
        (assignment) => assignment.listingType === requestedListingType,
      );
    }

    let recentActivity = [];
    let activityCount = 0;
    if (recordType === "staff" && invitation.staff?._id) {
      const activityQuery = {
        staff: invitation.staff._id,
        organiser: invitation.organiser?._id,
      };
      [recentActivity, activityCount] = await Promise.all([
        StaffActivity.find(activityQuery)
          .sort({ createdAt: -1 })
          .limit(25)
          .populate("staff", PERSON_FIELDS)
          .populate("organiser", PERSON_FIELDS)
          .lean(),
        StaffActivity.countDocuments(activityQuery),
      ]);
    }

    res.status(200).json({
      success: true,
      data: {
        invitation,
        recordType,
        recentActivity,
        activityCount,
      },
    });
  } catch (error) {
    console.error("[ADMIN GET EVENT TEAM DETAIL ERROR]", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching event team detail",
    });
  }
};

module.exports = {
  getCoOrganisers,
  getCoOrganiserDetail,
};

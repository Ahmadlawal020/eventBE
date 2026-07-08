const CoOrganiserInvitation = require("../../models/user/coOrganiserInvitation.schema");

const getCoOrganisers = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const query = {};

    if (status && status !== "all") query.status = status;

    const total = await CoOrganiserInvitation.countDocuments(query);

    let invitations = await CoOrganiserInvitation.find(query)
      .populate("host", "firstName surname email profilePicture")
      .populate("coOrganiser", "firstName surname email profilePicture")
      .populate("listings.listingId", "title venueName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    if (search) {
      const searchLower = search.toLowerCase();
      invitations = invitations.filter((inv) => {
        const hostMatch =
          inv.host?.email?.toLowerCase().includes(searchLower) ||
          inv.host?.firstName?.toLowerCase().includes(searchLower);
        const coOrgMatch =
          inv.coOrganiserEmail?.toLowerCase().includes(searchLower) ||
          inv.coOrganiser?.firstName?.toLowerCase().includes(searchLower);
        return hostMatch || coOrgMatch;
      });
    }

    res.status(200).json({
      success: true,
      data: {
        invitations,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET CO-ORGANISERS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching co-organisers" });
  }
};

const getCoOrganiserDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const invitation = await CoOrganiserInvitation.findById(id)
      .populate("host", "firstName surname email phoneNumber profilePicture createdAt")
      .populate("coOrganiser", "firstName surname email phoneNumber profilePicture createdAt")
      .lean();

    if (!invitation) {
      return res.status(404).json({ success: false, message: "Co-organiser invitation not found" });
    }

    // Populate listing details
    const Event = require("../../models/user/event.schema");
    const EventCenter = require("../../models/user/eventCenter.schema");

    const populatedListings = await Promise.all(
      (invitation.listings || []).map(async (listing) => {
        const Model = listing.listingType === "Event" ? Event : EventCenter;
        const doc = await Model.findById(listing.listingId)
          .select("title venueName status images location")
          .lean();
        return { ...listing, listingDetails: doc };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        invitation: { ...invitation, listings: populatedListings },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET CO-ORGANISER DETAIL ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching co-organiser detail" });
  }
};

module.exports = {
  getCoOrganisers,
  getCoOrganiserDetail,
};

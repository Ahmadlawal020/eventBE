const express = require("express");
const router = express.Router();

const {
  createEventCenter,
  getEventCenters,
  getEventCenterById,
  getMyDraftEventCenters,
  updateEventCenter,
  deleteEventCenter,
  getMyEventCenters,
  getPersonalEventCenterListings,
  reorderEventCenterImages,
  deleteEventCenterImage,
} = require("../../controllers/client/eventCenter.controller");

const verifyJWT = require("../../middleware/verifyJWT");
const {
  getPublicEventCenterSettings,
} = require("../../controllers/management/eventCenterSettings.controller");

// ====================
// AUTHENTICATED ROUTES
// ====================
router.post("/", verifyJWT, createEventCenter);
const media = require("../../controllers/client/eventMedia.controller");
const mediaLimit = require("../../middleware/generateLimiter")({ windowMs: 60000, max: 20, message: "Please wait before uploading more photos." });
router.post("/media/prepare", verifyJWT, mediaLimit, media.prepare);
router.post("/media/complete", verifyJWT, mediaLimit, media.complete);

router.get(
  "/my-event-center-listings",
  verifyJWT,
  getPersonalEventCenterListings,
);
router.get("/my-drafts", verifyJWT, getMyDraftEventCenters);
router.get("/my-event-centers", verifyJWT, getMyEventCenters);

router.patch("/:id/images/reorder", verifyJWT, reorderEventCenterImages);
router.patch("/:id/images/delete", verifyJWT, deleteEventCenterImage);

router.patch("/:id", verifyJWT, require("../../middleware/protectModerationFields"), updateEventCenter);
router.delete("/:id", verifyJWT, deleteEventCenter);

// ====================
// PUBLIC ROUTES
// ====================
const holderRefunds = require("../../controllers/client/eventCenterHolderRefundWorkspace.controller");
router.get("/:id/refund-workspace", verifyJWT, holderRefunds.summary);
router.get("/:id/refund-holders", verifyJWT, holderRefunds.holders);
router.get("/:id/refund-holder-tickets", verifyJWT, holderRefunds.holderTickets);
router.get("/:id/booking-refunds", verifyJWT, require("../../controllers/client/eventCenterRefundWorkspace.controller").list);
router.get("/settings", getPublicEventCenterSettings);
router.get("/", getEventCenters);
router.get("/:id", require("../../middleware/optionalJWT"), getEventCenterById); // MUST remain last

router.get("/:eventCenterId/reviews", require("../../controllers/client/venueReview.controller").public);
module.exports = router;

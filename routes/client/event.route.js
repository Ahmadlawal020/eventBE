const express = require("express");
const router = express.Router();

const {
  createEvent,
  getEvents,
  getEventById,
  getMyDraftEvents,
  updateEvent,
  updateEventPerformer,
  deletePerformerImage,
  deleteEvent,
  getMyEvents,
  getPersonalEventListings,
  reorderEventImages,
  deleteEventImage,
  deleteEventPerformer,
} = require("../../controllers/client/event.controller");

const verifyJWT = require("../../middleware/verifyJWT");
const cancellationController = require("../../controllers/client/eventCancellation.controller");
const refundController = require("../../controllers/client/eventRefund.controller");
const {
  getPublicEventSettings,
} = require("../../controllers/management/eventSettings.controller");

// ====================
// AUTHENTICATED ROUTES
// ====================
const media = require("../../controllers/client/eventMedia.controller");
const mediaLimit = require("../../middleware/generateLimiter")({ windowMs: 15 * 60000, max: 60, message: "Too many image uploads. Please retry later." });
router.post("/media/prepare", verifyJWT, mediaLimit, media.prepare);
router.post("/media/complete", verifyJWT, mediaLimit, media.complete);
router.post("/", verifyJWT, createEvent);

router.get("/my-event-listings", verifyJWT, getPersonalEventListings);
router.get("/my-drafts", verifyJWT, getMyDraftEvents);
router.get("/my-events", verifyJWT, getMyEvents);
router.get(
  "/:id/cancellation-preview",
  verifyJWT,
  cancellationController.cancellationPreview,
);
router.post("/:id/cancel", verifyJWT, cancellationController.cancelEvent);
const refundWorkspace = require("../../controllers/client/refundWorkspace.controller");
router.get("/:id/refund-workspace", verifyJWT, refundWorkspace.summary);
router.get("/:id/refund-holders", verifyJWT, refundWorkspace.holders);
router.get("/:id/refund-holder-tickets", verifyJWT, refundWorkspace.holderTickets);
router.get("/:id/refunds", verifyJWT, refundController.organiserRefunds);
router.get("/:id/buyers", verifyJWT, refundController.organiserBuyers);

router.patch("/:id/images/reorder", verifyJWT, reorderEventImages);
router.patch("/:id/images/delete", verifyJWT, deleteEventImage);

router.patch(
  "/:id/performers/:performerId/image/delete",
  verifyJWT,
  deletePerformerImage,
);
router.post(
  "/:id/performers",
  verifyJWT,
  require("../../controllers/client/eventPerformer.controller").save,
);
router.patch(
  "/:id/performers/:performerId",
  verifyJWT,
  require("../../controllers/client/eventPerformer.controller").save,
);
router.delete("/:id/performers/:performerId", verifyJWT, deleteEventPerformer);

router.patch(
  "/:id",
  verifyJWT,
  require("../../middleware/protectModerationFields"),
  updateEvent,
);
router.delete("/:id", verifyJWT, deleteEvent);

// ====================
// PUBLIC ROUTES
// ====================
router.get("/config", getPublicEventSettings);
router.get("/settings", getPublicEventSettings);
router.get("/", getEvents);
router.get("/:id", require("../../middleware/optionalJWT"), getEventById); // MUST remain last

module.exports = router;

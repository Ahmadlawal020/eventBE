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
const lifecycleController = require("../../controllers/client/eventLifecycle.controller");
const {
  getPublicEventSettings,
} = require("../../controllers/management/eventSettings.controller");

// ====================
// AUTHENTICATED ROUTES
// ====================
router.post("/", verifyJWT, createEvent);

router.get("/my-event-listings", verifyJWT, getPersonalEventListings);
router.get("/my-drafts", verifyJWT, getMyDraftEvents);
router.get("/my-events", verifyJWT, getMyEvents);
router.get(
  "/:id/cancellation-preview",
  verifyJWT,
  lifecycleController.cancellationPreview,
);
router.post("/:id/cancel", verifyJWT, lifecycleController.cancelEvent);
router.get("/:id/refunds", verifyJWT, lifecycleController.organiserRefunds);
router.get("/:id/buyers", verifyJWT, lifecycleController.organiserBuyers);

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

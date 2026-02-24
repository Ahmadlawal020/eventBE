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
} = require("../../controllers/user/eventCenter.controller");

const verifyJWT = require("../../middleware/verifyJWT");

// ====================
// AUTHENTICATED ROUTES
// ====================
router.post("/", verifyJWT, createEventCenter);

router.get(
  "/my-event-center-listings",
  verifyJWT,
  getPersonalEventCenterListings,
);
router.get("/my-drafts", verifyJWT, getMyDraftEventCenters);
router.get("/my-event-centers", verifyJWT, getMyEventCenters);

router.patch("/:id/images/reorder", verifyJWT, reorderEventCenterImages);
router.patch("/:id/images/delete", verifyJWT, deleteEventCenterImage);

router.patch("/:id", verifyJWT, updateEventCenter);
router.delete("/:id", verifyJWT, deleteEventCenter);

// ====================
// PUBLIC ROUTES
// ====================
router.get("/", getEventCenters);
router.get("/:id", getEventCenterById); // MUST remain last

module.exports = router;

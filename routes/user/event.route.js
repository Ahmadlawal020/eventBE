// const express = require("express");
// const router = express.Router();

// const {
//   createEvent,
//   getEvents,
//   getEventById,
//   getMyDraftEvents,
//   updateEvent,
//   deleteEvent,
//   getMyEvents,
//   getPersonalEventListings,
// } = require("../../controllers/user/event.controller");

// const verifyJWT = require("../../middleware/verifyJWT");

// // Protect create/update/delete with auth
// // router.post("/", verifyJWT, createEvent); // protect creation
// router.post("/", createEvent); // protect creation
// router.get("/", getEvents);
// router.get("/my-drafts", getMyDraftEvents);
// router.get("/my-events", getMyEvents);
// router.get("/my-event-listings", verifyJWT, getPersonalEventListings);
// router.get("/:id", getEventById);

// // router.put("/:id", verifyJWT, updateEvent); // optionally protect updates
// router.patch("/:id", updateEvent);

// router.delete("/:id", deleteEvent); // optionally protect deletes

// module.exports = router;

// const express = require("express");
// const router = express.Router();

// const {
//   createEvent,
//   getEvents,
//   getEventById,
//   getMyDraftEvents,
//   updateEvent,
//   updateEventPerformer,
//   deleteEvent,
//   getMyEvents,
//   getPersonalEventListings,
//   reorderEventImages,
//   deleteEventImage,
//   deleteEventPerformer,
// } = require("../../controllers/user/event.controller");

// const verifyJWT = require("../../middleware/verifyJWT");

// // ====================
// // USER-AUTH ROUTES
// // ====================

// // Protect user-specific routes
// router.post("/", verifyJWT, createEvent); // create event
// router.get("/my-event-listings", verifyJWT, getPersonalEventListings);
// router.get("/my-drafts", verifyJWT, getMyDraftEvents);
// router.get("/my-events", verifyJWT, getMyEvents);
// router.patch("/:id/images/reorder", reorderEventImages);
// router.patch("/:id/images/delete", deleteEventImage);
// router.delete("/:id/performers/:performerId", deleteEventPerformer);
// router.patch("/:id/performers/:performerId", updateEventPerformer);

// router.patch("/:id", verifyJWT, updateEvent); // optionally check ownership inside controller
// router.delete("/:id", verifyJWT, deleteEvent); // optionally check ownership inside controller

// // ====================
// // PUBLIC ROUTES
// // ====================
// router.get("/", getEvents);
// router.get("/:id", getEventById); // must be **last** to avoid catching other routes

// module.exports = router;

const express = require("express");
const router = express.Router();

const {
  createEvent,
  getEvents,
  getEventById,
  getMyDraftEvents,
  updateEvent,
  updateEventPerformer,
  deleteEvent,
  getMyEvents,
  getPersonalEventListings,
  reorderEventImages,
  deleteEventImage,
  deleteEventPerformer,
} = require("../../controllers/user/event.controller");

const verifyJWT = require("../../middleware/verifyJWT");

// ====================
// AUTHENTICATED ROUTES
// ====================
router.post("/", verifyJWT, createEvent);

router.get("/my-event-listings", verifyJWT, getPersonalEventListings);
router.get("/my-drafts", verifyJWT, getMyDraftEvents);
router.get("/my-events", verifyJWT, getMyEvents);

router.patch("/:id/images/reorder", verifyJWT, reorderEventImages);
router.patch("/:id/images/delete", verifyJWT, deleteEventImage);

router.patch("/:id/performers/:performerId", verifyJWT, updateEventPerformer);
router.delete("/:id/performers/:performerId", verifyJWT, deleteEventPerformer);

router.patch("/:id", verifyJWT, updateEvent);
router.delete("/:id", verifyJWT, deleteEvent);

// ====================
// PUBLIC ROUTES
// ====================
router.get("/", getEvents);
router.get("/:id", getEventById); // MUST remain last

module.exports = router;

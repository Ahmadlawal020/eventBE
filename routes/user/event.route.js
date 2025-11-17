const express = require("express");
const router = express.Router();

const {
  createEvent,
  getEvents,
  getEventById,
  getMyDraftEvents,
  updateEvent,
  deleteEvent,
  getMyEvents,
} = require("../../controllers/user/event.controllar");

const verifyJWT = require("../../middleware/verifyJWT");

// Protect create/update/delete with auth
// router.post("/", verifyJWT, createEvent); // protect creation
router.post("/", createEvent); // protect creation
router.get("/", getEvents);
router.get("/my-drafts", verifyJWT, getMyDraftEvents);
router.get("/my-events", verifyJWT, getMyEvents);
router.get("/:id", getEventById);

router.put("/:id", verifyJWT, updateEvent); // optionally protect updates
router.delete("/:id", verifyJWT, deleteEvent); // optionally protect deletes

module.exports = router;

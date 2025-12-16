// const Event = require("../../models/user/event.schema");

// const createDraftEvent = async (req, res) => {
//   try {
//     const { eventType } = req.body;

//     if (!eventType) {
//       return res.status(400).json({
//         success: false,
//         message: "eventType is required",
//       });
//     }

//     const newEvent = new Event({
//       eventType,
//       isDraft: true,
//       createdBy: req.user?.id || "68b6110236f2621324c21366",
//     });

//     const savedEvent = await newEvent.save();

//     res.status(201).json({
//       success: true,
//       message: "Draft event created",
//       data: savedEvent,
//     });
//   } catch (err) {
//     console.error("Error creating draft event:", err);
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//     });
//   }
// };

// module.exports = { createDraftEvent };

const Event = require("../../models/user/event.schema");

// 📌 Create Event
const createEvent = async (req, res) => {
  const {
    title,
    description,
    eventType,
    ageRestriction,
    schedule,
    capacity,
    isDraft,
  } = req.body;

  try {
    const newEvent = new Event({
      title,
      description,
      eventType, // must be one of the keys, e.g. "MUSIC_CONCERTS"
      ageRestriction,
      schedule,
      capacity,
      isDraft: !!isDraft,
      createdBy: req.user?.id || "68b6110236f2621324c21366", // fallback
    });

    const savedEvent = await newEvent.save();

    res.status(201).json({
      success: true,
      message: "Event created successfully",
      data: savedEvent,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 📋 Get All Events
const getEvents = async (req, res) => {
  try {
    const events = await Event.find().populate(
      "createdBy",
      "firstName surname email"
    );
    res.json({
      success: true,
      message: "Events fetched successfully",
      data: events,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 📌 Get Single Event by ID
const getEventById = async (req, res) => {
  const { id } = req.params;

  try {
    const event = await Event.findById(id).populate(
      "createdBy",
      "firstName surname email"
    );
    if (!event)
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });

    res.json({
      success: true,
      message: "Event fetched successfully",
      data: event,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 📋 Get Draft Events for the Logged-in User
const getMyDraftEvents = async (req, res) => {
  try {
    const drafts = await Event.find({
      isDraft: true,
      createdBy: req.user.id,
    }).populate("createdBy", "firstName surname email");

    res.json({
      success: true,
      message: "Your draft events fetched successfully",
      data: drafts,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✏️ Update Event
// const updateEvent = async (req, res) => {
//   const { id } = req.params;

//   console.log("[UPDATE EVENT] Incoming request:");
//   console.log("ID:", id);
//   console.log("Body:", req.body);

//   try {
//     const prevEvent = await Event.findById(id);
//     console.log("[UPDATE EVENT] Previous document:", prevEvent);

//     const updatedEvent = await Event.findByIdAndUpdate(id, req.body, {
//       new: true,
//       runValidators: true,
//     });

//     console.log("[UPDATE EVENT] Updated document:", updatedEvent);

//     if (!updatedEvent) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Event not found" });
//     }

//     res.json({
//       success: true,
//       message: "Event updated successfully",
//       data: updatedEvent,
//     });
//   } catch (err) {
//     console.error("[UPDATE EVENT] ERROR:", err);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

const updateEvent = async (req, res) => {
  const { id } = req.params;

  try {
    const prevEvent = await Event.findById(id);
    if (!prevEvent)
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });

    const updatePayload = { ...req.body };

    // 🔑 Ensure location is atomic
    if (updatePayload.location) {
      const loc = updatePayload.location;

      updatePayload.location = {
        addressString: loc.addressString ?? prevEvent.location.addressString,
        street: loc.street ?? prevEvent.location.street,
        flat: loc.flat ?? prevEvent.location.flat,
        city: loc.city ?? prevEvent.location.city,
        area: loc.area ?? prevEvent.location.area,
        postcode: loc.postcode ?? prevEvent.location.postcode,
        country: loc.country ?? prevEvent.location.country,
        isSpecificLocation:
          loc.isSpecificLocation ?? prevEvent.location.isSpecificLocation,
        coordinates: {
          latitude:
            loc.coordinates?.latitude ??
            prevEvent.location.coordinates.latitude,
          longitude:
            loc.coordinates?.longitude ??
            prevEvent.location.coordinates.longitude,
        },
      };
    }

    const updatedEvent = await Event.findByIdAndUpdate(id, updatePayload, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Event updated successfully",
      data: updatedEvent,
    });
  } catch (err) {
    console.error("[UPDATE EVENT] ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 🗑️ Delete Event
const deleteEvent = async (req, res) => {
  const { id } = req.params;

  try {
    const deletedEvent = await Event.findByIdAndDelete(id);

    if (!deletedEvent)
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });

    res.json({
      success: true,
      message: "Event deleted successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 📋 Get All NON-DRAFT Events for the Logged-in User
const getMyEvents = async (req, res) => {
  try {
    const events = await Event.find({
      isDraft: false,
      createdBy: req.user.id,
    }).populate("createdBy", "firstName surname email");

    res.json({
      success: true,
      message: "Your events fetched successfully",
      data: events,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  createEvent,
  getEvents,
  getMyEvents,
  getEventById,
  getMyDraftEvents,
  updateEvent,
  deleteEvent,
};

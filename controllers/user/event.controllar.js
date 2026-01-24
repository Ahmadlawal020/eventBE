const Event = require("../../models/user/event.schema");
const mongoose = require("mongoose");

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
      "firstName surname email",
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
      "firstName surname email",
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
const normalizeImagePositions = (images = []) => {
  return images
    .sort((a, b) => a.position - b.position)
    .map((img, index) => ({
      ...img,
      position: index,
    }));
};
/* ================================
   UPDATE EVENT (PATCH)
================================ */
const updateEvent = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid event ID",
    });
  }

  try {
    const prevEvent = await Event.findById(id);
    if (!prevEvent) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const updatePayload = { ...req.body };

    /* ================================
       IMAGE POSITION MANAGEMENT
    ================================= */
    if (Array.isArray(updatePayload.images)) {
      const existingImages = prevEvent.images || [];

      // Determine next available position
      const nextPosition =
        existingImages.length > 0
          ? Math.max(...existingImages.map((img) => img.position)) + 1
          : 0;

      // Assign positions to incoming images
      const incomingImages = updatePayload.images.map((img, index) => ({
        publicId: img.publicId,
        url: img.url,
        position: nextPosition + index,
      }));

      // Merge and normalize
      const mergedImages = normalizeImagePositions([
        ...existingImages,
        ...incomingImages,
      ]);

      updatePayload.images = mergedImages;
    }

    /* ================================
       LOCATION (ATOMIC UPDATE)
    ================================= */
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
    console.error("[UPDATE EVENT]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// controllers/user/event.controller.js

const deleteEventImage = async (req, res) => {
  const { id } = req.params;
  const { publicId } = req.body;

  if (!publicId) {
    return res.status(400).json({
      success: false,
      message: "publicId is required",
    });
  }

  try {
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    event.images = event.images
      .filter((img) => img.publicId !== publicId)
      .sort((a, b) => a.position - b.position)
      .map((img, index) => ({
        publicId: img.publicId,
        url: img.url,
        position: index,
      }));

    await event.save();

    res.json({
      success: true,
      message: "Image deleted successfully",
      data: event.images,
    });
  } catch (err) {
    console.error("[DELETE EVENT IMAGE]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const reorderEventImages = async (req, res) => {
  const { id } = req.params;
  const { publicId, toPosition } = req.body;

  if (!publicId || typeof toPosition !== "number") {
    return res.status(400).json({
      success: false,
      message: "publicId and toPosition are required",
    });
  }

  try {
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    // 1️⃣ Sort images by current position
    const images = [...event.images].sort((a, b) => a.position - b.position);

    // 2️⃣ Find image being moved
    const fromIndex = images.findIndex((img) => img.publicId === publicId);

    if (fromIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Image not found",
      });
    }

    // 3️⃣ Remove image from old position
    const [movedImage] = images.splice(fromIndex, 1);

    // 4️⃣ Insert image into new position
    images.splice(toPosition, 0, movedImage);

    // 5️⃣ Recalculate ALL positions
    event.images = images.map((img, index) => ({
      publicId: img.publicId,
      url: img.url,
      position: index,
    }));

    await event.save();

    res.json({
      success: true,
      message: "Image order updated successfully",
      data: event.images,
    });
  } catch (err) {
    console.error("[REORDER EVENT IMAGES]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
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

// 📋 Get Personal Event Listings (Lightweight)

const getPersonalEventListings = async (req, res) => {
  try {
    console.log("[GET PUBLISHED LISTINGS] req.user:", req.user);

    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const events = await Event.find({
      createdBy: req.user.id,
      // isDraft: false, // ✅ published only
    })
      .select({
        title: 1,
        images: 1,
        isDraft: 1,
        eventType: 1,
        location: 1,
      })
      .sort({ createdAt: -1 });

    const formattedEvents = events.map((event) => {
      const obj = event.toJSON(); // keeps eventTypeLabel

      return {
        _id: obj._id,
        title: obj.title,
        isDraft: obj.isDraft,
        eventTypeLabel: obj.eventTypeLabel,
        location: obj.location || null,
        images: obj.images || [], // ✅ FIXED
      };
    });

    res.json({
      success: true,
      message: "Published event listings fetched successfully",
      data: formattedEvents,
    });
  } catch (err) {
    console.error("[GET PUBLISHED LISTINGS] ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// 🗑️ Delete Performer from Event
const deleteEventPerformer = async (req, res) => {
  const { id, performerId } = req.params;

  if (!performerId) {
    return res.status(400).json({
      success: false,
      message: "performerId is required",
    });
  }

  try {
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const initialCount = event.performers.length;

    event.performers = event.performers.filter(
      (p) => p._id.toString() !== performerId,
    );

    if (event.performers.length === initialCount) {
      return res.status(404).json({
        success: false,
        message: "Performer not found",
      });
    }

    await event.save();

    res.json({
      success: true,
      message: "Performer deleted successfully",
      data: event.performers,
    });
  } catch (err) {
    console.error("[DELETE EVENT PERFORMER]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// ✏️ Update Performer in Event
const updateEventPerformer = async (req, res) => {
  const { id, performerId } = req.params;
  const { name, role, bio, image, socialLinks } = req.body;

  try {
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const performer = event.performers.id(performerId);

    if (!performer) {
      return res.status(404).json({
        success: false,
        message: "Performer not found",
      });
    }

    // Update fields safely
    performer.name = name ?? performer.name;
    performer.role = role ?? performer.role;
    performer.bio = bio ?? performer.bio;
    performer.image = image ?? performer.image;
    performer.socialLinks = socialLinks ?? performer.socialLinks;

    await event.save();

    res.json({
      success: true,
      message: "Performer updated successfully",
      data: performer,
    });
  } catch (err) {
    console.error("[UPDATE EVENT PERFORMER]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  createEvent,
  getEvents,
  getMyEvents,
  getEventById,
  getMyDraftEvents,
  updateEventPerformer,
  updateEvent,
  deleteEvent,
  getPersonalEventListings,
  reorderEventImages,
  deleteEventImage,
  deleteEventPerformer,
};

const { EVENT_FIELDS, prepareListingPatch } = require("../../utils/listingPatch");
const Event = require("../../models/client/event.schema");
const User = require("../../models/client/user.schema");
const Ticket = require("../../models/client/eventTicketType.schema");
const mongoose = require("mongoose");
const CoOrganiserInvitation = require("../../models/client/coOrganiserInvitation.schema");
const cloudinary = require("../../utils/cloudinary");
const {
  applyGuidanceDefaults,
  getEffectiveEventSettings: getEventSettings,
  normalizeTicketGuide,
  normalizeEventCancellationPolicy,
  organiserMeetsPublishingRequirements,
  validateEventPayload,
} = require("../../services/eventSettings.service");
const { realignTicketSalesWindows } = require("../../services/ticketSalesWindow.service");


async function canManageEventListing(event, userId) {
  if (String(event.createdBy) === String(userId)) return true;
  return Boolean(await CoOrganiserInvitation.findOne({
    coOrganiser: userId, host: event.createdBy, status: "ACCEPTED", "listings.listingId": event._id,
    permissions: { $in: ["MANAGE_LISTING", "ALL_ACCESS"] },
  }).lean());
}

// 📌 Create Event
const createEvent = async (req, res) => {
  const {
    title,
    shortDescription,
    description,
    images,
    highlights,
    amenities,
    eventType,
    ageRestriction,
    schedule,
    location,
    capacity,
    isDraft,
    safety,
    safetyConsiderations,
    ticketGuide,
    cancellationRefundProcess,
    cancellationRefundTimeline,
    arrivalGuide,
    performers,
    entry,
  } = req.body;

  try {
    const settings = await getEventSettings();
    const payload = normalizeEventCancellationPolicy(applyGuidanceDefaults(
      {
        title,
        shortDescription,
        description,
        images,
        highlights,
        amenities,
        eventType,
        ageRestriction,
        schedule,
        location,
        capacity,
        isDraft,
        safety,
        safetyConsiderations,
        ticketGuide,
        ...(cancellationRefundProcess !== undefined ? { cancellationRefundProcess } : {}),
        ...(cancellationRefundTimeline !== undefined ? { cancellationRefundTimeline } : {}),
        arrivalGuide,
        performers,
        entry,
      },
      settings,
    ));
    payload.ticketGuide = normalizeTicketGuide(payload.ticketGuide);
    const validationErrors = validateEventPayload(payload, settings, {
      publishing: isDraft === false,
    });
    if (validationErrors.length) {
      return res.status(400).json({
        success: false,
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    let status = "IN_PROGRESS";
    if (isDraft === false) {
      const user = await User.findById(req.user.id).select(
        "isIdentityVerified isPhoneVerified vendorAccountCode bankDetails",
      );
      const canAutoPublish =
        settings.publishing.autoPublishVerifiedOrganisers &&
        organiserMeetsPublishingRequirements(user, settings);
      status = canAutoPublish ? "LISTED" : "ACTION_REQUIRED";
    }

    const newEvent = new Event({
      title,
      shortDescription,
      description,
      images,
      highlights,
      amenities,
      eventType,
      ageRestriction,
      schedule: payload.schedule,
      location,
      capacity,
      status,
      createdBy: req.user.id,
      safety,
      safetyConsiderations,
      ticketGuide: payload.ticketGuide,
      cancellationRefundProcess: payload.cancellationRefundProcess,
      cancellationRefundTimeline: payload.cancellationRefundTimeline,
      arrivalGuide: payload.arrivalGuide,
      performers,
      entry,
    });

    const savedEvent = await mongoose.connection.transaction(async session => {
      if (images?.length || performers?.length) await require("../../services/eventMedia.service").attachMedia(
        { images, performers }, {}, newEvent._id, req.user.id, session);
      return newEvent.save({ session });
    });

    res.status(201).json({
      success: true,
      message: "Event created successfully",
      data: savedEvent,
    });
  } catch (err) {
    console.error(err);
    if (err.status === 400 || err.name === "ValidationError" || err.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: Object.values(err.errors || {})[0]?.message || err.message || "Invalid event",
      });
    }
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 📋 Get All Events
const getEvents = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      Event.find({ status: "LISTED" })
        .populate("createdBy", "firstName surname")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Event.countDocuments({ status: "LISTED" }),
    ]);

    res.json({
      success: true,
      message: "Events fetched successfully",
      data: events,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
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
    const event = await Event.findById(id)
      .populate(
        "createdBy",
        "firstName surname profilePicture isIdentityVerified isPhoneVerified",
      )
      .populate("coOrganisers", "firstName surname profilePicture")
      .populate("staff", "firstName surname profilePicture");
    if (!event)
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });

    if (!require("../../services/listingVisibility").canViewListing(event, req.user)) return res.status(404).json({ success: false, message: "Listing is not available." });

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
      status: "IN_PROGRESS",
      $or: [{ createdBy: req.user.id }, { coOrganisers: req.user.id }],
    }).populate("createdBy", "firstName surname");

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
      // Mongoose subdocument properties are getters, not spreadable own fields.
      publicId: img.publicId,
      url: img.url,
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

    // Permission check: co-organisers need MANAGE_LISTING
    const isOwner = prevEvent.createdBy?.toString() === req.user.id;
    if (!isOwner) {
      const coOrganiserInvite = await CoOrganiserInvitation.findOne({
        coOrganiser: req.user.id,
        host: prevEvent.createdBy,
        status: "ACCEPTED",
        "listings.listingId": id,
      }).lean();
      const perms = coOrganiserInvite?.permissions || [];
      if (!perms.includes("MANAGE_LISTING") && !perms.includes("ALL_ACCESS")) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to manage this listing",
        });
      }
    }

    if (prevEvent.status === "CANCELLED") {
      return res.status(409).json({ success: false, message: "You can't update this field because the event has been cancelled." });
    }

    const updatePayload = normalizeEventCancellationPolicy(
      prepareListingPatch(req.body, EVENT_FIELDS, prevEvent.toObject()),
      prevEvent.toObject(),
    );
    delete updatePayload.previousTicketPolicy;
    if (prevEvent.status === "CANCELLED" &&
        (updatePayload.status !== undefined || updatePayload.isDraft !== undefined)) {
      return res.status(409).json({ success: false, message: "A cancelled event cannot be relisted. Create a new event instead." });
    }
    const { occurrenceEnded, changeSchedule } = require("../../services/eventOccurrence.service");
    const ended = occurrenceEnded(prevEvent);
    if (ended && !updatePayload.schedule && (updatePayload.status !== undefined || updatePayload.isDraft !== undefined))
      return res.status(409).json({ success: false, message: "Choose new dates before reopening an ended event." });
    if (prevEvent.status === "CANCELLED" && updatePayload.schedule)
      return res.status(409).json({ success: false, message: "A cancelled event cannot be rescheduled." });
    if (updatePayload.status === "IN_PROGRESS" && prevEvent.status !== "IN_PROGRESS") {
      return res.status(409).json({ success: false, message: "Published events cannot return to draft. Unlist to stop sales, or use cancellation." });
    }
    const settings = await getEventSettings(prevEvent.managementLocation);

    /* ================================
       IMAGE POSITION MANAGEMENT
    ================================= */
    if (Array.isArray(updatePayload.images)) {
      const existingImages = prevEvent.images || [];
      const incomingImages = updatePayload.images;

      // Filter out existing images that are being "replaced" or "re-sent"
      const incomingPublicIds = new Set(
        incomingImages.map((img) => img.publicId),
      );
      const filteredExisting = existingImages.filter(
        (img) => !incomingPublicIds.has(img.publicId),
      );

      // Determine next available position
      const nextPosition =
        filteredExisting.length > 0
          ? Math.max(...filteredExisting.map((img) => img.position)) + 1
          : 0;

      // Assign positions to incoming images
      const newImages = incomingImages.map((img, index) => ({
        publicId: img.publicId,
        url: img.url,
        position: nextPosition + index,
      }));

      // Merge and normalize
      const mergedImages = normalizeImagePositions([
        ...filteredExisting,
        ...newImages,
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

    /* ================================
       TICKET GUIDE / TERMS & POLICY (NORMALIZATION)
    ================================= */
    if (updatePayload.ticketGuide) {
      updatePayload.ticketGuide = normalizeTicketGuide(updatePayload.ticketGuide);
    }

    const previousObject = prevEvent.toObject();
    const mergedPayload = { ...previousObject, ...updatePayload };
    const resubmittingCompletedEvent =
      ended &&
      updatePayload.schedule?.to &&
      new Date(updatePayload.schedule.to) > new Date();
    const validationErrors = validateEventPayload(mergedPayload, settings, {
      publishing:
        updatePayload.isDraft === false ||
        ["LISTED", "ACTION_REQUIRED"].includes(updatePayload.status) ||
        resubmittingCompletedEvent,
      requireComplete: updatePayload.isDraft === false ||
        ["LISTED", "ACTION_REQUIRED"].includes(updatePayload.status) ||
        resubmittingCompletedEvent ||
        (prevEvent.status === "LISTED" && !["IN_PROGRESS", "UNLISTED"].includes(updatePayload.status)),
      existing: true,
      changes: updatePayload,
    });
    if (validationErrors.length) {
      return res.status(400).json({
        success: false,
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    // Handle status transition
    if (updatePayload.isDraft === false) {
      const user = await User.findById(prevEvent.createdBy);
      const canAutoPublish =
        settings.publishing.autoPublishVerifiedOrganisers &&
        organiserMeetsPublishingRequirements(user, settings);
      updatePayload.status = canAutoPublish ? "LISTED" : "ACTION_REQUIRED";

      delete updatePayload.isDraft;
    } else if (
      updatePayload.status === "LISTED" ||
      updatePayload.status === "ACTION_REQUIRED"
    ) {
      const user = await User.findById(prevEvent.createdBy);
      const canAutoPublish =
        settings.publishing.autoPublishVerifiedOrganisers &&
        organiserMeetsPublishingRequirements(user, settings);
      updatePayload.status = canAutoPublish ? "LISTED" : "ACTION_REQUIRED";
    } else if (ended && updatePayload.schedule?.to) {
      const newToDate = new Date(updatePayload.schedule.to);
      if (newToDate > new Date()) {
        const user = await User.findById(prevEvent.createdBy);
        const canAutoPublish =
          settings.publishing.autoPublishVerifiedOrganisers &&
          organiserMeetsPublishingRequirements(user, settings);
        updatePayload.status = canAutoPublish ? "LISTED" : "ACTION_REQUIRED";
      }
    }

    delete updatePayload.isDraft;
    let adjustedTicketCount = 0;
    const updatedEvent = await mongoose.connection.transaction(async session => {
      const locked = await Event.findOneAndUpdate(
        { _id: id, status: prevEvent.status, updatedAt: prevEvent.updatedAt },
        { $inc: { saleVersion: 1 } }, { new: true, session });
      if (!locked) throw Object.assign(Error("This event changed. Refresh before saving."), { status: 409 });
      if (updatePayload.images || updatePayload.performers) await require("../../services/eventMedia.service").attachMedia(
        updatePayload, locked, id, req.user.id, session);
      if (updatePayload.schedule && await require("../../models/client/userEventTicket.schema").exists({ eventId: id, refundHold: true }).session(session))
        throw Object.assign(Error("Resolve tickets held for refund settlement before changing dates."), { status: 409 });
      const restarted = await changeSchedule(locked, updatePayload, req.body.previousTicketPolicy, session);
      if (updatePayload.capacity !== undefined || restarted) await require("../../services/eventCapacity.service").assertEventCapacity(
        { _id: locked._id, occurrence: updatePayload.occurrence ?? locked.occurrence, capacity: updatePayload.capacity ?? locked.capacity }, 0, session);
      const result = await Event.findByIdAndUpdate(id, { $set: updatePayload }, { new: true, runValidators: true, session });
      if (updatePayload.schedule) {
        adjustedTicketCount = await realignTicketSalesWindows(id, result.schedule?.to || result.schedule?.from, null, session);
        if (!restarted) {
          const UserTicket = require("../../models/client/userEventTicket.schema");
          const { occurrenceFilter } = require("../../services/eventOccurrence.service");
          const filter = { eventId: id, ...occurrenceFilter(locked.occurrence || 0), status: "UNREDEEMED" };
          const holders = await UserTicket.distinct("owner", filter).session(session);
          await UserTicket.updateMany(filter, { $set: { validSchedule: result.schedule } }, { session });
          await require("../../services/refundNotifications.service").queueNotices(holders.map(recipient => ({
            key: "event-rescheduled:" + id + ":" + result.updatedAt.getTime() + ":" + recipient,
            recipient, sender: result.createdBy, type: "SYSTEM", title: "Event dates changed",
            message: '"' + result.title + '" has new dates: ' + new Date(result.schedule.from).toISOString() + '. Your ticket remains valid. Open Tickets for details.',
            data: { eventId: id, screen: "Tickets" },
          })), session);
        }
      }
      return result;
    });

    res.json({
      success: true,
      message: adjustedTicketCount > 0
        ? `Event updated successfully. ${adjustedTicketCount} ticket tier(s) had their sales end time adjusted to match the new event end time.`
        : "Event updated successfully",
      data: updatedEvent,
      adjustedTicketCount,
    });

  } catch (err) {
    console.error("[UPDATE EVENT]", err);
    if (err.status === 409) return res.status(409).json({ success: false, message: err.message });
    if (err.status === 400 || err.name === "ValidationError" || err.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: Object.values(err.errors || {})[0]?.message || err.message || "Invalid event",
      });
    }
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
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid event ID." });
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }
    if (!await canManageEventListing(event, req.user.id)) return res.status(403).json({ success: false, message: "You do not have permission to manage this listing." });
    if (event.status === "CANCELLED") return res.status(409).json({ success: false, message: "You can't update this field because the event has been cancelled." });


    if (!event.images?.some(image => image.publicId === publicId)) return res.status(404).json({ success: false, message: "Image not found in this event." });
    // Legacy public uploads have no trusted server ownership record. Remove the
    // reference only; private refund proof has its own verified cleanup pipeline.
    // 2️⃣ Remove from database
    const settings = await getEventSettings(event.managementLocation);
    const requiredImages = Math.max(settings.publishing.requireCoverImage ? 1 : 0,
      settings.publishing.minimumImages || 0, settings.contentLimits.minImages || 0);
    if (event.status === "LISTED" && event.images.filter(image => image.publicId !== publicId).length < requiredImages)
      return res.status(409).json({ success: false, message: "Add a replacement image before removing this published event's required images." });
    event.images = event.images
      .filter((img) => img.publicId !== publicId)
      .sort((a, b) => a.position - b.position)
      .map((img, index) => ({
        publicId: img.publicId,
        url: img.url,
        position: index,
      }));

    const saved = await Event.findOneAndUpdate({ _id: id, updatedAt: event.updatedAt }, { $set: { images: event.images } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ success: false, message: "This event changed. Refresh before removing an image." });

    res.json({
      success: true,
      message: "Image removed from the event",
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

  if (typeof publicId !== "string" || !Number.isInteger(toPosition) || toPosition < 0) {
    return res.status(400).json({
      success: false,
      message: "publicId and toPosition are required",
    });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid event ID." });
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }
    if (!await canManageEventListing(event, req.user.id)) return res.status(403).json({ success: false, message: "You do not have permission to manage this listing." });
    if (event.status === "CANCELLED") return res.status(409).json({ success: false, message: "You can't update this field because the event has been cancelled." });


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
    const event = await Event.findById(id);

    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }

    // Only the original creator can delete an event
    if (event.createdBy.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only the original host can remove this listing",
      });
    }

    // 1️⃣ Delete associated tickets
    await mongoose.connection.transaction(async session => {
      const draft = await Event.findOneAndUpdate({ _id: id, status: "IN_PROGRESS", createdBy: req.user.id },
        { $inc: { saleVersion: 1 } }, { new: true, session });
      if (!draft || await require("../../models/client/eventBooking.schema").exists({ eventId: id }).session(session) ||
          await require("../../models/client/eventRefund.schema").exists({ eventId: id }).session(session)) {
        throw Object.assign(new Error("Only unused drafts can be deleted. Cancel or unlist published events to preserve buyer and refund records."), { statusCode: 409 });
      }
      await Ticket.deleteMany({ eventId: id }, { session });
      await Event.deleteOne({ _id: id }, { session });
    });

    // 3️⃣ Respond immediately so the client doesn't time out
    res.json({
      success: true,
      message: "Event deleted successfully",
    });

    // Keep legacy storage assets until ownership is established by an upload registry.

  } catch (err) {
    console.error("[DELETE EVENT]", err);
    res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : "Server error" });
  }
};

// 📋 Get All NON-DRAFT Events for the Logged-in User
const getMyEvents = async (req, res) => {
  try {
    await syncUserEvents(req.user.id);

    const events = await Event.find({
      status: { $in: ["LISTED", "ACTION_REQUIRED", "UNLISTED"] },
      $or: [{ createdBy: req.user.id }, { coOrganisers: req.user.id }],
    }).populate("createdBy", "firstName surname");

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

    await syncUserEvents(req.user.id);

    const events = await Event.find({
      $or: [{ createdBy: req.user.id }, { coOrganisers: req.user.id }],
    })
      .select({
        title: 1,
        images: 1,
        status: 1,
        eventType: 1,
        location: 1,
        createdAt: 1,
        createdBy: 1,
      })
      .sort({ createdAt: -1 });

    const userId = req.user.id;
    const formattedEvents = events.map((event) => {
      const obj = event.toJSON(); // keeps eventTypeLabel

      return {
        _id: obj._id,
        title: obj.title,
        status: obj.status,
        eventTypeLabel: obj.eventTypeLabel,
        location: obj.location || null,
        images: obj.images || [], // ✅ FIXED
        createdAt: obj.createdAt,
        isCoOrganiser: obj.createdBy?.toString() !== userId,
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
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid event ID." });
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }
    if (!await canManageEventListing(event, req.user.id)) return res.status(403).json({ success: false, message: "You do not have permission to manage this listing." });
    if (event.status === "CANCELLED") return res.status(409).json({ success: false, message: "You can't update this field because the event has been cancelled." });


    const performer = event.performers.id(performerId);

    if (!performer) {
      return res.status(404).json({
        success: false,
        message: "Performer not found",
      });
    }

    event.performers = event.performers.filter(
      (p) => p._id.toString() !== performerId,
    );

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
const updateEventPerformer = (req, res) => require("./eventPerformer.controller").save(req, res);

// 🗑️ Delete Performer Image
const deletePerformerImage = async (req, res) => {
  const { id, performerId } = req.params;
  const { publicId } = req.body;

  if (!publicId) {
    return res.status(400).json({
      success: false,
      message: "publicId is required",
    });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid event ID." });
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }
    if (!await canManageEventListing(event, req.user.id)) return res.status(403).json({ success: false, message: "You do not have permission to manage this listing." });
    if (event.status === "CANCELLED") return res.status(409).json({ success: false, message: "You can't update this field because the event has been cancelled." });


    const performer = event.performers.id(performerId);

    if (!performer) {
      return res.status(404).json({
        success: false,
        message: "Performer not found",
      });
    }

    performer.image = null;
    await event.save();

    res.json({
      success: true,
      message: "Performer image deleted successfully",
      data: performer,
    });
  } catch (err) {
    console.error("[DELETE PERFORMER IMAGE]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// ===================== SYNC EVENTS ON VERIFICATION =====================
const syncUserEvents = async (userId, { throwOnError = false } = {}) => {
  try {
    const [user, settings] = await Promise.all([
      User.findById(userId),
      getEventSettings(),
    ]);
    if (!user) return;

    const meetsRequirements = organiserMeetsPublishingRequirements(
      user,
      settings,
    );
    if (
      meetsRequirements &&
      settings.publishing.autoPublishVerifiedOrganisers
    ) {
      const pending = await Event.find({ createdBy: userId, status: "ACTION_REQUIRED" }).lean();
      for (const event of pending) {
        const currentSettings = await getEventSettings(event.managementLocation);
        if (!currentSettings.publishing.autoPublishVerifiedOrganisers || !organiserMeetsPublishingRequirements(user, currentSettings)) continue;
        if (validateEventPayload(event, currentSettings, { publishing: true, requireComplete: true }).length) continue;
        if (require("../../services/eventOccurrence.service").occurrenceEnded(event)) continue;
        await Event.updateOne({ _id: event._id, status: "ACTION_REQUIRED", updatedAt: event.updatedAt }, { $set: { status: "LISTED" } });
      }
    } else if (!meetsRequirements) {
      await Event.updateMany(
        { createdBy: userId, status: "LISTED" },
        { status: "ACTION_REQUIRED" },
      );
    }
  } catch (err) {
    console.error("[SYNC USER EVENTS]", err);
    if (throwOnError) throw err;
  }
};

module.exports = {
  createEvent,
  getEvents,
  getMyEvents,
  getEventById,
  getMyDraftEvents,
  updateEventPerformer,
  deletePerformerImage,
  updateEvent,
  deleteEvent,
  getPersonalEventListings,
  reorderEventImages,
  deleteEventImage,
  deleteEventPerformer,
  syncUserEvents,
};

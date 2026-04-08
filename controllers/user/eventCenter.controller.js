const EventCenter = require("../../models/user/eventCenter.schema");
const mongoose = require("mongoose");
const cloudinary = require("../../utils/cloudinary");

// ===================== CREATE EVENT CENTER =====================
const createEventCenter = async (req, res) => {
  const {
    venueType,
    venueName,
    shortDescription,
    description,
    supportedEvents,
    amenities,
    images,
    availability,
    capacity,
    bookingSettings,
    basePrice,
    discounts,
    venueRules,
    customVenueRules,
    safety,
    entry,
    location,
    isDraft,
    yourSpace,
    arrivalGuide,
  } = req.body;

  try {
    const newCenter = new EventCenter({
      venueType,
      venueName,
      shortDescription,
      description,
      supportedEvents,
      amenities,
      images,
      availability,
      capacity,
      bookingSettings,
      basePrice,
      discounts,
      venueRules,
      customVenueRules,
      safety,
      entry,
      location,
      isDraft: !!isDraft,
      createdBy: req.user?.id || "68b6110236f2621324c21366",
      yourSpace,
      arrivalGuide,
    });

    const savedCenter = await newCenter.save();

    res.status(201).json({
      success: true,
      message: "Event Center created successfully",
      data: savedCenter,
    });
  } catch (err) {
    console.error("[CREATE EVENT CENTER]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===================== GET ALL EVENT CENTERS =====================
const getEventCenters = async (req, res) => {
  try {
    const centers = await EventCenter.find().populate(
      "createdBy",
      "firstName surname email",
    );

    res.json({
      success: true,
      message: "Event Centers fetched successfully",
      data: centers,
    });
  } catch (err) {
    console.error("[GET EVENT CENTERS]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===================== GET SINGLE EVENT CENTER BY ID =====================
const getEventCenterById = async (req, res) => {
  const { id } = req.params;

  try {
    const center = await EventCenter.findById(id).populate(
      "createdBy",
      "firstName surname email",
    );

    if (!center)
      return res
        .status(404)
        .json({ success: false, message: "Event Center not found" });

    res.json({
      success: true,
      message: "Event Center fetched successfully",
      data: center,
    });
  } catch (err) {
    console.error("[GET EVENT CENTER BY ID]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===================== GET MY DRAFT EVENT CENTERS =====================
const getMyDraftEventCenters = async (req, res) => {
  try {
    const drafts = await EventCenter.find({
      isDraft: true,
      createdBy: req.user.id,
    }).populate("createdBy", "firstName surname email");

    res.json({
      success: true,
      message: "Your draft event centers fetched successfully",
      data: drafts,
    });
  } catch (err) {
    console.error("[GET MY DRAFT EVENT CENTERS]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===================== DELETE EVENT CENTER =====================
const deleteEventCenter = async (req, res) => {
  const { id } = req.params;

  try {
    const center = await EventCenter.findById(id);

    if (!center) {
      return res
        .status(404)
        .json({ success: false, message: "Event Center not found" });
    }

    // 1️⃣ Delete images from Cloudinary (if credentials are available)
    if (center.images && center.images.length > 0) {
      // Check if Cloudinary is properly configured
      const hasCloudinaryConfig =
        process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;

      if (hasCloudinaryConfig) {
        const deletePromises = center.images.map((img) =>
          cloudinary.uploader.destroy(img.publicId).catch((err) => {
            console.error(
              `[CLOUDINARY DELETE ERROR] for ${img.publicId}:`,
              err,
            );
          }),
        );
        await Promise.all(deletePromises);
        console.log(
          `[DELETE EVENT CENTER] Deleted ${center.images.length} images from Cloudinary`,
        );
      } else {
        console.warn(
          "[DELETE EVENT CENTER] Cloudinary credentials not configured. Skipping image deletion from Cloudinary.",
        );
      }
    }

    // 2️⃣ Delete the event center itself
    await EventCenter.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Event Center deleted successfully",
    });
  } catch (err) {
    console.error("[DELETE EVENT CENTER]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===================== UPDATE EVENT CENTER (PATCH) =====================
const normalizeImagePositions = (images = []) =>
  images
    .sort((a, b) => a.position - b.position)
    .map((img, index) => ({ ...img, position: index }));

const updateEventCenter = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id))
    return res
      .status(400)
      .json({ success: false, message: "Invalid Event Center ID" });

  try {
    const prevCenter = await EventCenter.findById(id);
    if (!prevCenter)
      return res
        .status(404)
        .json({ success: false, message: "Event Center not found" });

    const updatePayload = { ...req.body };

    // ===== Image handling =====
    if (Array.isArray(updatePayload.images)) {
      const existingImages = prevCenter.images || [];
      const incomingImages = updatePayload.images;

      // Filter out existing images that are being "replaced" or "re-sent"
      const incomingPublicIds = new Set(
        incomingImages.map((img) => img.publicId),
      );
      const filteredExisting = existingImages.filter(
        (img) => !incomingPublicIds.has(img.publicId),
      );

      const nextPosition =
        filteredExisting.length > 0
          ? Math.max(...filteredExisting.map((img) => img.position)) + 1
          : 0;

      const newImages = incomingImages.map((img, index) => ({
        publicId: img.publicId,
        url: img.url,
        position: nextPosition + index,
      }));

      updatePayload.images = normalizeImagePositions([
        ...filteredExisting,
        ...newImages,
      ]);
    }

    // ===== Availability atomic update =====
    if (updatePayload.availability) {
      const avail = updatePayload.availability;
      updatePayload.availability = {
        ...prevCenter.availability,
        ...avail,
      };
    }

    // ===== Location atomic update =====
    if (updatePayload.location) {
      const loc = updatePayload.location;
      updatePayload.location = {
        addressString: loc.addressString ?? prevCenter.location.addressString,
        street: loc.street ?? prevCenter.location.street,
        flat: loc.flat ?? prevCenter.location.flat,
        city: loc.city ?? prevCenter.location.city,
        area: loc.area ?? prevCenter.location.area,
        postcode: loc.postcode ?? prevCenter.location.postcode,
        country: loc.country ?? prevCenter.location.country,
        isSpecificLocation:
          loc.isSpecificLocation ?? prevCenter.location.isSpecificLocation,
        coordinates: {
          latitude:
            loc.coordinates?.latitude ??
            prevCenter.location.coordinates.latitude,
          longitude:
            loc.coordinates?.longitude ??
            prevCenter.location.coordinates.longitude,
        },
      };
    }

    const updatedCenter = await EventCenter.findByIdAndUpdate(
      id,
      updatePayload,
      {
        new: true,
        runValidators: true,
      },
    );

    res.json({
      success: true,
      message: "Event Center updated successfully",
      data: updatedCenter,
    });
  } catch (err) {
    console.error("[UPDATE EVENT CENTER]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===================== IMAGE MANAGEMENT =====================
const deleteEventCenterImage = async (req, res) => {
  const { id } = req.params;
  const { publicId } = req.body;

  if (!publicId)
    return res
      .status(400)
      .json({ success: false, message: "publicId is required" });

  try {
    const center = await EventCenter.findById(id);
    if (!center)
      return res
        .status(404)
        .json({ success: false, message: "Event Center not found" });

    // 1️⃣ Delete from Cloudinary
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (cloudinaryErr) {
      console.error("[CLOUDINARY DELETE ERROR]", cloudinaryErr);
    }

    // 2️⃣ Remove from database
    center.images = center.images
      .filter((img) => img.publicId !== publicId)
      .sort((a, b) => a.position - b.position)
      .map((img, index) => ({ ...img, position: index }));

    await center.save();

    res.json({
      success: true,
      message: "Image deleted successfully from database and Cloudinary",
      data: center.images,
    });
  } catch (err) {
    console.error("[DELETE EVENT CENTER IMAGE]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const reorderEventCenterImages = async (req, res) => {
  const { id } = req.params;
  const { publicId, toPosition } = req.body;

  if (!publicId || typeof toPosition !== "number")
    return res.status(400).json({
      success: false,
      message: "publicId and toPosition are required",
    });

  try {
    const center = await EventCenter.findById(id);
    if (!center)
      return res
        .status(404)
        .json({ success: false, message: "Event Center not found" });

    const images = [...center.images].sort((a, b) => a.position - b.position);
    const fromIndex = images.findIndex((img) => img.publicId === publicId);
    if (fromIndex === -1)
      return res.status(404).json({
        success: false,
        message: "Image not found",
      });

    const [movedImage] = images.splice(fromIndex, 1);
    images.splice(toPosition, 0, movedImage);
    center.images = images.map((img, index) => ({ ...img, position: index }));

    await center.save();

    res.json({
      success: true,
      message: "Image order updated successfully",
      data: center.images,
    });
  } catch (err) {
    console.error("[REORDER EVENT CENTER IMAGES]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===================== GET MY EVENT CENTERS =====================
const getMyEventCenters = async (req, res) => {
  try {
    const centers = await EventCenter.find({
      createdBy: req.user.id,
      isDraft: false,
    }).populate("createdBy", "firstName surname email");

    res.json({
      success: true,
      message: "Your event centers fetched successfully",
      data: centers,
    });
  } catch (err) {
    console.error("[GET MY EVENT CENTERS]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===================== GET PERSONAL EVENT CENTER LISTINGS =====================
const getPersonalEventCenterListings = async (req, res) => {
  try {
    if (!req.user?.id)
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });

    const centers = await EventCenter.find({ createdBy: req.user.id })
      .select({
        venueName: 1,
        images: 1,
        isDraft: 1,
        venueType: 1,
        location: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1 });

    const formattedCenters = centers.map((center) => {
      const obj = center.toJSON();
      return {
        _id: obj._id,
        venueName: obj.venueName,
        isDraft: obj.isDraft,
        venueType: obj.venueType,
        location: obj.location || null,
        images: obj.images || [],
        createdAt: obj.createdAt,
      };
    });

    res.json({
      success: true,
      message: "Published event center listings fetched successfully",
      data: formattedCenters,
    });
  } catch (err) {
    console.error("[GET PERSONAL EVENT CENTER LISTINGS]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  createEventCenter,
  getEventCenters,
  getEventCenterById,
  getMyDraftEventCenters,
  updateEventCenter,
  deleteEventCenter,
  deleteEventCenterImage,
  reorderEventCenterImages,
  getMyEventCenters,
  getPersonalEventCenterListings,
};

const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");

/**
 * @desc    Record an analytics interaction (click, share, view)
 * @route   POST /api/analytics/track
 * @access  Public (no auth required — tracking should work for all users)
 */
const recordInteraction = async (req, res) => {
  try {
    const { contextType, contextId, interactionType } = req.body;

    if (!contextType || !contextId || !interactionType) {
      return res.status(400).json({
        status: "fail",
        message: "Missing required fields: contextType, contextId, interactionType",
      });
    }

    const Model =
      contextType === "Event"
        ? Event
        : contextType === "EventCenter"
          ? EventCenter
          : null;

    if (!Model) {
      return res.status(400).json({ status: "fail", message: "Invalid contextType" });
    }

    // Only allow specific interactions to prevent arbitrary field updates
    const allowed = ["clicks", "shares", "views"];
    if (!allowed.includes(interactionType)) {
      return res.status(400).json({ status: "fail", message: "Invalid interactionType" });
    }

    // Atomic increment
    const updated = await Model.findByIdAndUpdate(
      contextId,
      { $inc: { [`performance.${interactionType}`]: 1 } },
      { new: true },
    ).select("performance");

    if (!updated) {
      return res.status(404).json({ status: "fail", message: "Listing not found" });
    }

    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Error in recordInteraction:", error);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

module.exports = { recordInteraction };

const User = require("../models/client/user.schema");
const Event = require("../models/client/event.schema");
const { organiserMeetsPublishingRequirements } = require("./eventSettings.service");
async function keepUnreadyEventPending(event, session) {
  if (event.status !== "LISTED") return;
  const owner = await User.findById(event.createdBy).select("isIdentityVerified vendorAccountCode").session(session);
  if (!organiserMeetsPublishingRequirements(owner)) {
    await Event.updateOne({ _id: event._id, status: "LISTED" }, { $set: { status: "ACTION_REQUIRED" } }, { session });
  }
}
module.exports = { keepUnreadyEventPending };

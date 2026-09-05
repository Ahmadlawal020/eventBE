const User = require("../../models/client/user.schema");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");

const buildHealthSnapshot = async () => {
  const [users, actionRequiredEvents, actionRequiredEventCenters] = await Promise.all([
    User.countDocuments(),
    Event.countDocuments({ status: "ACTION_REQUIRED" }),
    EventCenter.countDocuments({ status: "ACTION_REQUIRED" }),
  ]);

  return {
    users,
    actionRequiredListings: actionRequiredEvents + actionRequiredEventCenters,
    generatedAt: new Date(),
  };
};

module.exports = {
  buildHealthSnapshot,
};

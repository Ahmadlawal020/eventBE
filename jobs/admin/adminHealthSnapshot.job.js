const User = require("../../models/user/user.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");

const buildAdminHealthSnapshot = async () => {
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
  buildAdminHealthSnapshot,
};

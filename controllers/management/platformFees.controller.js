const PlatformFees = require("../../models/management/platformFees.schema");
const { recordAdminAction } = require("../../services/management/adminAudit.service");
const { normaliseTicketFeeSettings } = require("../../services/ticketFees.service");

const responseData = (fees) => ({
  ...normaliseTicketFeeSettings(fees),
  eventCenterCommission: Number(fees.eventCenterCommission ?? 15),
});

const getPlatformFees = async (req,res) => {
  try {
    const fees = await PlatformFees.findOneAndUpdate({ key: "platform_fees" },
      { $setOnInsert: { key: "platform_fees" } }, { upsert: true, new: true });
    res.json({ success: true, data: responseData(fees) });
  } catch (error) { res.status(500).json({ success: false, message: "Could not load platform settings" }); }
};
const updatePlatformFees = async (req,res) => {
  try {
    if (!req.user.roles.some(role => ["admin","super_admin","superadmin","finance_admin","finance"].includes(role))) return res.status(403).json({ success:false, message:"Finance or full administrator access required" });
    const update = {};
    for (const field of ["eventCommission","eventCenterCommission"]) {
      if (!(field in req.body)) continue;
      const value = req.body[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return res.status(400).json({ success:false, message: field + " must be between 0 and 100" });
      update[field] = value;
    }
    if ("ticketFeesEnabled" in req.body) {
      if (typeof req.body.ticketFeesEnabled !== "boolean") return res.status(400).json({ success:false, message:"ticketFeesEnabled must be a boolean" });
      update.ticketFeesEnabled = req.body.ticketFeesEnabled;
    }
    if ("ticketFeeMode" in req.body) {
      const modes = ["ORGANISER_CHOICE","PASS_TO_BUYER","ABSORB_BY_ORGANISER"];
      if (!modes.includes(req.body.ticketFeeMode)) return res.status(400).json({ success:false, message:"Invalid ticket fee mode" });
      update.ticketFeeMode = req.body.ticketFeeMode;
    }
    if ("ticketFixedFeeCents" in req.body) {
      const amount = req.body.ticketFixedFeeCents;
      if (!Number.isInteger(amount) || amount < 0 || amount > 100000000) return res.status(400).json({ success:false, message:"Ticket fixed fee must be a valid minor-unit amount" });
      update.ticketFixedFeeCents = amount;
    }
    if ("ticketFeeCapCents" in req.body) {
      const cap = req.body.ticketFeeCapCents;
      if (cap !== null && (!Number.isInteger(cap) || cap < 0 || cap > 100000000)) return res.status(400).json({ success:false, message:"Ticket fee cap must be null or a valid minor-unit amount" });
      update.ticketFeeCapCents = cap;
    }
    const previous = await PlatformFees.findOne({ key:"platform_fees" }).lean();
    const fees = await PlatformFees.findOneAndUpdate({ key:"platform_fees" }, { $set:update }, { upsert:true,new:true,runValidators:true });
    await recordAdminAction({ req, action:"PLATFORM_FEES_UPDATED", targetType:"System", targetId:fees._id, previousValue:previous, newValue:responseData(fees) });
    res.json({ success:true,data:responseData(fees) });
  } catch(error) { res.status(error.status || 500).json({ success:false,message:error.status ? error.message : "Could not save platform settings" }); }
};
module.exports = { getPlatformFees, updatePlatformFees };

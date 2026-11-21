const service = require("../../services/clientVenueReschedule.service");
const handle = work => async (req, res) => { try { res.json({ success: true, data: await work(req) }); } catch (error) { const status = error.status || error.statusCode || (error.name === "CastError" ? 400 : 500); res.status(status).json({ message: status === 500 ? "Could not complete the reschedule. Check payment status before trying again." : error.message }); } };
exports.preview = handle(async req => (await service.prepare(req.params.id, req.body.dates, req.user.id)).review);
exports.submit = handle(req => service.submit(req.params.id, req.body.dates, req.user.id, req.body));
exports.state = handle(req => service.state(req.params.id, req.user.id));
exports.resume = handle(async req => {
 const state = await service.state(req.params.id, req.user.id);
 if (!state.payment || state.payment.status !== "ACTIVE") throw Object.assign(new Error("There is no pending reschedule payment."), { status: 409 });
 const attempt = await require("../../models/client/venueRescheduleCheckout.schema").findOne({ booking: req.params.id, buyer: req.user.id, status: "ACTIVE" }).lean();
 if (!attempt) throw Object.assign(new Error("Payment status changed. Refresh the booking."), { status: 409 });
 return service.resume(attempt._id, req.user.id);
});
exports.verify = handle(async req => {
 const Attempt = require("../../models/client/venueRescheduleCheckout.schema");
 const attempt = await Attempt.findOne({ booking: req.params.id, buyer: req.user.id, paymentReference: req.body.reference }).lean();
 if (!attempt) throw Object.assign(new Error("Reschedule payment not found."), { status: 404 });
 return service.verify(attempt.paymentReference, req.user.id);
});

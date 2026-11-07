const service = require("../../services/manualRefundSettlement.service");
const handle=fn=>async(req,res)=>{try{res.set("Cache-Control","no-store");res.json({success:true,data:await fn(req)});}catch(e){res.status(e.status || e.statusCode || 500).json({message:e.status || e.statusCode?e.message:"Could not complete the refund action."});}};
const args=req=>[req.params.venueId,req.params.bookingId,req.user.id];
exports.details=handle(async req=>service.publicDetails(await service.access(...args(req))));
exports.update=handle(req=>service.update(...args(req),req.body || {}));
exports.prepare=handle(req=>service.prepareUpload(req.params.venueId,req.params.bookingId,req.params.refundId,req.user.id,req.body?.settlementId));
exports.complete=handle(req=>service.completeUpload(req.params.venueId,req.params.bookingId,req.params.refundId,req.user.id,req.body || {}));
exports.receipt=handle(req=>service.receipt(req.params.venueId,req.params.bookingId,req.params.refundId,req.user.id));

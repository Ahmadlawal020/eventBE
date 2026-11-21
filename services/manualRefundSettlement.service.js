const mongoose = require("mongoose"), { randomUUID } = require("crypto");
const Operations = require("../models/client/bookingOperations.schema"), Venue = require("../models/client/eventCenter.schema");
const Upload = require("../models/client/manualRefundUpload.schema"), cloudinary = require("../utils/cloudinary");
const { fail, hasVenuePermission } = require("./venueAccess.service");
const { normalizeRefundBankDetails } = require("./eventCenterRefundBankDetails.service");
async function access(venueId, bookingId, actor, session = null) {
  if (!mongoose.isValidObjectId(venueId) || (!/^manual-[a-zA-Z0-9_-]{1,100}$/.test(bookingId || "") && !mongoose.isValidObjectId(bookingId))) throw fail(400,"Invalid manual booking.");
  const venue = await Venue.findById(venueId).session(session).lean();
  if (!venue) throw fail(404,"Venue not found.");
  const record = await Operations.findById(`${venueId}:${bookingId}`).session(session);
  if (!record) throw fail(404,"Booking payment record not found.");
  if (!String(bookingId).startsWith("manual-") && !record.rescheduleAdjustment) throw fail(404,"Reschedule payment record not found.");
  const customer = String(record.customerId || "") === String(actor);
  const manager = await hasVenuePermission(actor,venue,["VIEW_FINANCES"]) && await hasVenuePermission(actor,venue,["MANAGE_BOOKINGS"]);
  if (!customer && !manager) throw fail(403,"This refund belongs to another booking or requires finance access.");
  const booking = record.rescheduleAdjustment ? await require("./bookingAttendance.service").loadBooking(venueId, bookingId) : null;
  return { venue, record, customer, manager, booking };
}
function publicDetails({record,customer,manager,booking}) {
  return { payments: record.rescheduleAdjustment ? (record.payments || []).filter(p => ["PAYMENT", "REFUND"].includes(p.kind)).map(p => ({ id: p.id, kind: p.kind, amountMinor: p.amountMinor, reference: p.reference, at: p.at })) : undefined, summary: booking && !(booking.status === "CANCELLED" && !String(record.bookingId).startsWith("manual-")) ? require("./bookingOperations.service").paymentSummary(booking, record.toObject ? record.toObject() : record) : undefined, revision: record.revision, customer, canManage: manager, linked: Boolean(record.customerId), account: record.refundAccount,
    refunds: record.refunds.map(f => ({ id:f.id, amountMinor:f.amountMinor, reason:f.reason, status:f.status, sentAt:f.sentAt, confirmedAt:f.confirmedAt,
      settlement:f.settlement, receipt:f.receipt?.uploadedAt ? {uploadedAt:f.receipt.uploadedAt} : undefined })) };
}
function target(record,id) { const f=record.refunds.find(f=>f.id===id); if(!f)throw fail(404,"Refund installment not found.");return f; }
function editable(f,settlementId) {
  if(f.status!=="APPROVED" || !f.settlement?.id || f.settlement.id!==settlementId)throw fail(409,"Prepare this refund and refresh its status before uploading proof.");
}
async function commit(context,action,actor,session,reason) {
  const {venue,record}=context;
  if(venue.archivedAt)throw fail(409,"This venue is archived.");
  if (!String(record.bookingId).startsWith("manual-") && await require("../models/client/eventCenterBooking.schema").exists({ _id: record.bookingId, rescheduleCheckoutId: { $ne: null } }).session(session)) throw fail(409,"Finish or check the pending reschedule payment before changing refund details.");
  await Venue.updateOne({_id:venue._id},{$inc:{bookingVersion:1}},{session});
  record.revision += 1;record.audit.push({action,actor,at:new Date(),reason:reason || "Manual refund updated"});
  await record.save({session});
  const hostRecipients = [...new Set([venue.createdBy, ...(venue.coOrganisers || [])].filter(Boolean).map(String))];
  const customerRecipient = record.customerId ? String(record.customerId) : null;
  const venueLabel = venue.venueName || "Venue";
  const notices = [];
  if (action === "BANK_DETAILS") {
    for (const recipient of hostRecipients) {
      notices.push({
        key: `manual-refund:${record._id}:${record.revision}:${recipient}`,
        recipient,
        type: "SYSTEM",
        title: "Refund bank details submitted",
        message: `${venueLabel}: a client submitted their bank details for a reschedule refund. Tap to review and settle.`,
        data: { screen: "VenueBookingOperations", venueId: String(venue._id), bookingId: record.bookingId, ticketId: record.bookingId },
      });
    }
  } else if ((action === "PREPARE" || action === "REFUND_RECEIPT") && customerRecipient) {
    notices.push({
      key: `manual-refund:${record._id}:${record.revision}:${customerRecipient}`,
      recipient: customerRecipient,
      type: "SYSTEM",
      title: action === "REFUND_RECEIPT" ? "Refund payment proof uploaded" : "Refund payment being prepared",
      message: action === "REFUND_RECEIPT"
        ? `${venueLabel}: payment proof was uploaded for your refund. Open your booking to review.`
        : `${venueLabel}: your refund payment is being prepared. Open your booking for the latest status.`,
      data: { screen: String(record.bookingId).startsWith("manual-") ? "ManualVenueBooking" : "TicketDetails", venueId: String(venue._id), bookingId: record.bookingId, ticketId: record.bookingId },
    });
  } else {
    const allRecipients = [...new Set([...hostRecipients, ...(customerRecipient ? [customerRecipient] : [])])];
    for (const recipient of allRecipients) {
      const isHost = hostRecipients.includes(recipient);
      notices.push({
        key: `manual-refund:${record._id}:${record.revision}:${recipient}`,
        recipient,
        type: "SYSTEM",
        title: "Refund arrangement updated",
        message: `${venueLabel}: open your booking for the latest refund details.`,
        data: { screen: isHost ? "VenueBookingOperations" : String(record.bookingId).startsWith("manual-") ? "ManualVenueBooking" : "TicketDetails", venueId: String(venue._id), bookingId: record.bookingId, ticketId: record.bookingId },
      });
    }
  }
  if (notices.length) {
    await require("./eventCenterRefundNotifications.service").queueNotices(notices, session);
  }
}
async function update(venueId,bookingId,actor,payload) {
  return mongoose.connection.transaction(async session=>{
    const context=await access(venueId,bookingId,actor,session),{record,manager,customer}=context;
    if(record.revision!==payload.expectedRevision)throw fail(409,"Refund details changed. Refresh and try again.");
    if(payload.action==="BANK_DETAILS") {
      if(record.customerId && !customer)throw fail(403,"The linked customer must supply their own bank details.");
      if(record.refunds.some(f=>f.settlement?.id && f.status!=="CONFIRMED"))throw fail(409,"Bank details are locked for an outstanding payment. Ask the organiser to release an unpaid preparation before correcting them.");
      record.refundAccount={...normalizeRefundBankDetails(payload),updatedBy:actor,updatedAt:new Date()};
    } else {
      if(!manager)throw fail(403,"Finance access is required to prepare a refund.");
      const f=target(record,payload.refundId);
      if(f.status!=="APPROVED")throw fail(409,"This refund has already been sent.");
      if(payload.action==="PREPARE") {
        if(!["BANK_TRANSFER","CASH","POS","OTHER"].includes(payload.method))throw fail(400,"Choose the refund payment method.");
        if(f.settlement?.id)throw fail(409,"This refund is already prepared. Use its locked details.");
        const bankDetails=payload.method==="BANK_TRANSFER"?normalizeRefundBankDetails(record.refundAccount?.toObject() || {}):undefined;
        f.settlement={id:randomUUID(),method:payload.method,bankDetails,preparedAt:new Date()};
      } else if(payload.action==="RELEASE_PREPARATION") {
        if(!f.settlement?.id || f.receipt?.uploadedAt || payload.confirmNoPayment!==true || typeof payload.reason!=="string" || !payload.reason.trim())throw fail(409,"Only an unpaid preparation without proof can be released. Confirm no money was sent and record a reason.");
        f.settlement=undefined;
      } else throw fail(400,"Unknown refund action.");
    }
    await commit(context,payload.action,actor,session,String(payload.reason || "").slice(0,500));
    return publicDetails(context);
  });
}
async function prepareUpload(venueId,bookingId,refundId,actor,settlementId) {
  const {record,manager,venue}=await access(venueId,bookingId,actor);
  if(!manager)throw fail(403,"Finance access is required to upload proof.");
  if(venue.archivedAt)throw fail(409,"This venue is archived.");
  editable(target(record,refundId),settlementId);
  const config=cloudinary.config();if(!config.cloud_name || !config.api_key || !config.api_secret)throw fail(503,"Private receipt storage is not configured.");
  const publicId=`manual-refund-receipts/${venueId}/${randomUUID()}`;
  await Upload.create({publicId,recordId:record._id,refundId,owner:actor,settlementId,expiresAt:new Date(Date.now()+3600000),cleanupAfter:new Date(Date.now()+86400000)});
  const parameters={timestamp:Math.floor(Date.now()/1000),public_id:publicId,type:"authenticated",overwrite:false,allowed_formats:"jpg,jpeg,png,webp"};
  return {cloudName:config.cloud_name,apiKey:config.api_key,parameters,signature:cloudinary.utils.api_sign_request(parameters,config.api_secret)};
}
async function completeUpload(venueId,bookingId,refundId,actor,{publicId,settlementId,expectedRevision}) {
  const initial=await access(venueId,bookingId,actor);
  if(!initial.manager)throw fail(403,"Finance access is required to upload proof.");
  const prior=target(initial.record,refundId);
  if(prior.receipt?.publicId===publicId && prior.receipt.settlementId===settlementId)return publicDetails(initial);
  editable(prior,settlementId);
  const attempt=await Upload.findOne({publicId,recordId:initial.record._id,refundId,owner:actor,settlementId,state:"PENDING",expiresAt:{$gt:new Date()}}).lean();
  if(!attempt)throw fail(409,"Receipt upload expired or belongs to another refund.");
  const asset=await cloudinary.api.resource(publicId,{type:"authenticated",resource_type:"image"});
  if(asset.public_id!==publicId || asset.type!=="authenticated" || asset.resource_type!=="image" || !["jpg","jpeg","png","webp"].includes(asset.format) || !Number.isFinite(asset.bytes) || asset.bytes<=0 || asset.bytes>5*1024*1024)throw fail(422,"Choose a JPEG, PNG or WebP receipt under 5 MB.");
  return mongoose.connection.transaction(async session=>{
    const context=await access(venueId,bookingId,actor,session),{record}=context;
    if(!context.manager)throw fail(403,"Finance access is required.");
    const f=target(record,refundId);
    if(f.receipt?.publicId===publicId && f.receipt.settlementId===settlementId)return publicDetails(context);
    editable(f,settlementId);
    if(record.revision!==expectedRevision)throw fail(409,"Refund details changed. Refresh and retry this upload.");
    const claimed=await Upload.findOneAndUpdate({_id:attempt._id,state:"PENDING",expiresAt:{$gt:new Date()}},{$set:{state:"ATTACHED"}},{session,new:true});
    if(!claimed)throw fail(409,"Receipt upload expired. Select the receipt again.");
    if(f.receipt?.publicId)await Upload.updateOne({publicId:f.receipt.publicId},{$set:{state:"PENDING",cleanupAfter:new Date(Date.now()+86400000)}},{session});
    f.receipt={publicId,format:asset.format,uploadedAt:new Date(),settlementId};
    await commit(context,"REFUND_RECEIPT",actor,session);
    return publicDetails(context);
  });
}
async function receipt(venueId,bookingId,refundId,actor) {
  const {record}=await access(venueId,bookingId,actor),f=target(record,refundId);
  if(!f.receipt?.publicId)throw fail(404,"Receipt not found.");
  return {url:cloudinary.utils.private_download_url(f.receipt.publicId,f.receipt.format,{type:"authenticated",resource_type:"image",attachment:false,expires_at:Math.floor(Date.now()/1000)+300})};
}
async function cleanup({limit=50}={}) {
  const attempts=await Upload.find({state:{$ne:"DELETED"},cleanupAfter:{$lte:new Date()}}).sort({cleanupAfter:1}).limit(limit).lean();
  let deleted=0,failed=0;
  for(const attempt of attempts)try {
    const claimed=await mongoose.connection.transaction(async session=>{
      const item=await Upload.findOneAndUpdate({_id:attempt._id,state:{$ne:"DELETED"},cleanupAfter:{$lte:new Date()}},{$set:{state:"CLEANING",cleanupAfter:new Date(Date.now()+600000)}},{new:true,session});
      if(!item)return false;
      if(await Operations.exists({"refunds.receipt.publicId":item.publicId}).session(session)) {
        await Upload.updateOne({_id:item._id},{$set:{state:"ATTACHED",cleanupAfter:new Date(Date.now()+86400000)}},{session});return false;
      }return true;
    });
    if(!claimed)continue;
    const result=await cloudinary.uploader.destroy(attempt.publicId,{type:"authenticated",resource_type:"image"});
    if(!["ok","not found"].includes(result?.result))throw Error("Storage did not confirm deletion");
    await Upload.updateOne({_id:attempt._id,state:"CLEANING"},{$set:{state:"DELETED",lastError:null}});deleted++;
  }catch(e){failed++;await Upload.updateOne({_id:attempt._id},{$set:{lastError:"Receipt cleanup needs retry",cleanupAfter:new Date(Date.now()+3600000)}});}
  return {deleted,failed};
}
module.exports={access,publicDetails,update,prepareUpload,completeUpload,receipt,cleanup};

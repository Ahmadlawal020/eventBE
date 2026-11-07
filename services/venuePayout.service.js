const mongoose=require("mongoose");
const Payout=require("../models/client/venuePayout.schema");
const Booking=require("../models/client/eventCenterBooking.schema");
const User=require("../models/client/user.schema");
const Venue=require("../models/client/eventCenter.schema");
const {getPaymentGateway}=require("./payment");
const {fail}=require("./checkoutSafety.service");
const {generateTicketNumber,generateQRPayload}=require("../utils/qr");
async function confirmReviewBooking(id,organiserId){
 return mongoose.connection.transaction(async session=>{
  const booking=await Booking.findById(id).select("+payoutDestination").session(session);
  if(!booking)throw fail("Booking not found",404);
  if(String(booking.organiser)!==String(organiserId))throw fail("Not authorised to accept this booking",403);
  if(booking.status==="CONFIRMED")return {booking,changed:false};
  if(booking.status!=="PENDING_REVIEW" || booking.paymentStatus!=="COMPLETED" || booking.paymentResolutionRequired)throw fail("Only paid bookings awaiting review can be accepted",409);
  require("./venueReviewPolicy.service").assertReviewOpen(booking);
  const venue=await Venue.findById(booking.eventCenter).session(session);
  const ownBlocks=booking.bookingUnit==="day"?venue?.availability?.unavailableDates:venue?.availability?.unavailableSlots;
  if(!booking.selectedDates.every(d=>(ownBlocks||[]).some(b=>String(b.bookingId)===String(booking._id)&&new Date(b.date).toISOString().slice(0,10)===new Date(d.date).toISOString().slice(0,10))))throw fail("The booking dates are no longer reserved. Contact the guest to resolve this booking.",409);
  const destination=booking.payoutDestination || (await User.findById(organiserId).session(session))?.bankDetails;
  if(!destination?.accountNumber || !destination?.bankCode)throw fail("Add a valid payout bank account before accepting this booking",409);
  if(booking.totalPrice.currency!=="NGN")throw fail("Automatic review-booking payouts currently require NGN",409);
  if(!Number.isFinite(booking.organiserPayoutAmount))throw fail("This legacy booking requires payout reconciliation before approval",409);
  const amountMinor=Math.round(booking.organiserPayoutAmount*100);
  await Payout.create([{booking:booking._id,organiser:organiserId,reference:`venue-${booking._id}`,amountMinor,currency:booking.totalPrice.currency,destination,status:amountMinor===0?"SUCCESS":"READY"}],{session});
  booking.status="CONFIRMED";booking.reviewedAt=new Date();booking.referralQualifiedAt=new Date();
  booking.ticketNumber=generateTicketNumber("MNS");booking.qrPayload=generateQRPayload(booking.ticketNumber,booking.eventCenter,"EVENT_CENTER");
  await booking.save({session});
  await require("./venueBookingEvents.service").recordVenueEvent(booking, "ACCEPTED", organiserId, session);
  return {booking,changed:true};
 });
}
async function processVenuePayout(id) {
 const token = require("crypto").randomUUID();
 const payout = await Payout.findOneAndUpdate({ _id:id, status:{$in:["READY","PREPARING","SUBMITTING","PENDING"]}, $or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:new Date()}}] },
   {$set:{leaseUntil:new Date(Date.now()+120000),leaseToken:token}}, {new:true}).select("+destination");
 if (!payout) return;
 const filter = { _id:id, leaseToken:token };
 const gateway = getPaymentGateway();
 const write = async values => (await Payout.updateOne(filter, {$set:values})).modifiedCount;
 try {
   if (["READY", "PREPARING"].includes(payout.status)) {
     const claimed = await Payout.updateOne({...filter, status:{$in:["READY","PREPARING"]},leaseUntil:{$gt:new Date()}}, {$set:{status:"PREPARING"}});
     if (!claimed.matchedCount) return;
     const booking = await Booking.findById(payout.booking).lean();
     if (!booking || !["CONFIRMED", "COMPLETED"].includes(booking.status) || booking.paymentStatus !== "COMPLETED" || booking.refund?.state) {
       await write({status:"NEEDS_ATTENTION",lastError:"Booking is not eligible for payout"}); return;
     }
     let recipientCode = payout.recipientCode;
     if (!recipientCode) {
       const recipient = await gateway.createTransferRecipient({...payout.destination,currency:payout.currency});
       recipientCode = recipient.recipient_code;
       if (!await write({recipientCode})) return;
     }
     // Only the current lease owner can cross the external-transfer boundary.
     const submitting = await Payout.updateOne({...filter,status:"PREPARING",leaseUntil:{$gt:new Date()}},{$set:{status:"SUBMITTING"}});
     if (!submitting.modifiedCount) return;
     const transfer = await gateway.transferToOrganiser({amount:payout.amountMinor,currency:payout.currency,recipient:recipientCode,reference:payout.reference});
     await write({providerStatus:transfer.status,status:transfer.status==="success"?"SUCCESS":transfer.status==="otp"?"NEEDS_ATTENTION":["failed","reversed"].includes(transfer.status)?"FAILED":"PENDING",lastError:""});
   } else {
     const current = await gateway.verifyTransfer(payout.reference);
     await write({providerStatus:current.status,status:current.status==="success"?"SUCCESS":["failed","reversed"].includes(current.status)?"FAILED":current.status==="otp"?"NEEDS_ATTENTION":"PENDING",lastError:""});
   }
 } catch (error) {
   await write({lastError:error.response?.data?.message || error.message,...(error.response?.status>=400 && error.response.status<500?{status:"NEEDS_ATTENTION"}:{})});
 } finally { await write({leaseUntil:new Date(Date.now()+60000)}); }
}
module.exports={confirmReviewBooking,processVenuePayout};

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
  if(booking.reviewDeadline && booking.reviewDeadline<new Date())throw fail("The review deadline has passed",409);
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
  return {booking,changed:true};
 });
}
async function processVenuePayout(id){
 const payout=await Payout.findOneAndUpdate({_id:id,status:{$in:["READY","SUBMITTING","PENDING"]},$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:new Date()}}]},{$set:{leaseUntil:new Date(Date.now()+120000)}},{new:true}).select("+destination");
 if(!payout)return;
 const gateway=getPaymentGateway();
 try{
  if(payout.status!=="READY"){
   // Never blindly repeat a transfer after a timeout or process restart.
   // Reconcile the deterministic reference before deciding anything else.
   const current=await gateway.verifyTransfer(payout.reference);
   payout.providerStatus=current.status;
   payout.status=current.status==="success"?"SUCCESS":["failed","reversed"].includes(current.status)?"FAILED":current.status==="otp"?"NEEDS_ATTENTION":"PENDING";
  }else{
   if(!payout.recipientCode){
    const recipient=await gateway.createTransferRecipient({...payout.destination,currency:payout.currency});
    payout.recipientCode=recipient.recipient_code;
    await payout.save();
   }
   payout.status="SUBMITTING";await payout.save();
   const transfer=await gateway.transferToOrganiser({amount:payout.amountMinor,currency:payout.currency,recipient:payout.recipientCode,reference:payout.reference});
   payout.providerStatus=transfer.status;
   payout.status=transfer.status==="success"?"SUCCESS":transfer.status==="otp"?"NEEDS_ATTENTION":["failed","reversed"].includes(transfer.status)?"FAILED":"PENDING";
  }
  payout.lastError=undefined;
 }catch(error){
  payout.lastError=error.response?.data?.message || error.message;
  // A definitive rejection requires operator attention; an ambiguous network
  // response stays SUBMITTING and is reconciled using the same reference.
  if(error.response?.status>=400 && error.response.status<500)payout.status="NEEDS_ATTENTION";
 }finally{
  payout.leaseUntil=new Date(Date.now()+60000);await payout.save();
 }
}
module.exports={confirmReviewBooking,processVenuePayout};

const {notifyTicketPurchased,notifyVenueBookingRequest,notifyVenueBookingInstant}=require("./notification");
const Event=require("../models/client/event.schema");
const Venue=require("../models/client/eventCenter.schema");
async function notifyPaymentCompletion(result){
 if(!result.changed || result.conflict)return;
 try{
  const b=result.booking;
  if(result.type==="EVENT_TICKET"){
   const event=await Event.findById(b.eventId).select("title schedule location venueName createdBy").lean();
   await notifyTicketPurchased({booking:b,event,buyer:{_id:b.buyer,fullName:b.guestDetails?.fullName,email:b.guestDetails?.email},reference:b.paymentReference});
  }else{
   const eventCenter=await Venue.findById(b.eventCenter).select("bookingSettings venueName").lean();
   const notify=b.bookingMode==="REVIEW"?notifyVenueBookingRequest:notifyVenueBookingInstant;
   await notify({booking:b,eventCenter,guestName:b.guestDetails?.fullName,buyerId:b.buyer,organiserId:b.organiser});
   const {logBookingHistory}=require("../controllers/client/bookingHistory.controller");
   await logBookingHistory({eventCenter:b.eventCenter,ticket:b._id,bookingId:String(b._id),bookingType:"PLATFORM",action:"CREATED",performedBy:b.buyer,dates:b.selectedDates,guestName:b.guestDetails?.fullName,totalPrice:b.totalPrice});
  }
 }catch(error){console.error("[PAYMENT NOTIFICATION]",error.message);}
}
module.exports={notifyPaymentCompletion};

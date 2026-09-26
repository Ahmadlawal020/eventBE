const { CronJob } = require("cron");
const Booking = require("../models/client/eventBooking.schema");
const { getPaymentGateway } = require("../services/payment");
const { expireEventReservation, completePayment } = require("../services/checkoutSafety.service");
const {notifyPaymentCompletion}=require("../services/paymentCompletionNotifications.service");
const {recordBookingReferral}=require("../services/referral.service");
let running=false;
async function expireReservations() {
  if(running)return;running=true;
  try {
    const bookings=await Booking.find({paymentStatus:"PENDING",status:"ACTIVE",reservationExpiresAt:{$lte:new Date()}}).sort({reservationExpiresAt:1}).limit(100);
    for(const booking of bookings) {
      try {
        const payment=await getPaymentGateway().verifyPayment(booking.paymentReference);
        if(payment.status==="success") {
          const result=await completePayment(booking.paymentReference,payment,{kind:"EVENT_TICKET"});
          if(!result.conflict)await recordBookingReferral(result.booking._id,"EVENT_TICKET");
          await notifyPaymentCompletion(result);
        }
        else if(["abandoned","failed","pending","ongoing"].includes(payment.status)) await expireEventReservation(booking._id);
        // Late payments after expiry are recorded for organiser follow-up.
        // Never release inventory on a network timeout.
      } catch(error) {
        if(error.response?.status===404 || (error.response?.status===400 && /^transaction (?:not found|reference not found)$/i.test(error.response?.data?.message || ""))) await expireEventReservation(booking._id);
        else console.error("[PAYMENT RESERVATION]",error.message);
      }
    }
  } finally {running=false;}
}
new CronJob("*/5 * * * *",expireReservations,null,true);
module.exports={expireReservations};

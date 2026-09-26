const {notifyPaymentCompletion}=require("../../services/paymentCompletionNotifications.service");
const {getPaymentGateway}=require("../../services/payment");
const {completePayment}=require("../../services/checkoutSafety.service");
const {recordBookingReferral}=require("../../services/referral.service");
const gateway=getPaymentGateway();
const handlePaymentWebhook=async(req,res)=>{
  try {
    if(!gateway.validateWebhookSignature(req.rawBody,req.headers))return res.status(400).send("Invalid signature");
    const event=gateway.parseWebhookEvent(req.body);
    if(event.event!=="charge.success" || event.status!=="success")return res.status(200).send("Ignored event");
    // The database determines booking type, buyer, inventory and price. Gateway
    // metadata is never a source of authority for issuing tickets.
    const result=await completePayment(event.reference,{reference:event.reference,status:event.status,amount:Math.round(event.amount*100),currency:event.currency,paid_at:event.paidAt});
    if(!result.conflict)await recordBookingReferral(result.booking._id,result.type==="EVENT_TICKET"?"EVENT_TICKET":"EVENT_CENTER_BOOKING");
    await notifyPaymentCompletion(result);
    return res.status(200).send(result.conflict?"Payment recorded; organiser follow-up required":"OK");
  } catch(error){
    if(error.statusCode===404 || error.statusCode===409)return res.status(200).send("No payable booking");
    return res.status(error.statusCode || 500).send(error.statusCode?error.message:"Payment processing failed");
  }
};
module.exports={handlePaymentWebhook};

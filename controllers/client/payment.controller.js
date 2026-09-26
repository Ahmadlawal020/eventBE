const {getPaymentGateway}=require("../../services/payment");
const EventBooking=require("../../models/client/eventBooking.schema");
const VenueBooking=require("../../models/client/eventCenterBooking.schema");
const initializePayment=async(_req,res)=>res.status(410).json({success:false,message:"Start payment through an event or venue booking."});
const verifyPayment=async(req,res)=>{
  try {
    const booking=await EventBooking.findOne({paymentReference:req.params.reference}) || await VenueBooking.findOne({paymentReference:req.params.reference});
    if(!booking || String(booking.buyer)!==String(req.user.id))return res.status(404).json({success:false,message:"Payment not found"});
    const payment=await getPaymentGateway().verifyPayment(req.params.reference);
    return res.json({success:payment.status==="success",data:{reference:payment.reference,status:payment.status,amount:payment.amount,currency:payment.currency}});
  } catch(error){return res.status(502).json({success:false,message:"Could not verify payment"});}
};
module.exports={initializePayment,verifyPayment};

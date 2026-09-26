const {Schema,model}=require("mongoose");
module.exports=model("VenuePayout",new Schema({
  booking:{type:Schema.Types.ObjectId,ref:"EventCenterBooking",required:true,unique:true},
  organiser:{type:Schema.Types.ObjectId,ref:"User",required:true},
  reference:{type:String,required:true,unique:true},
  amountMinor:{type:Number,required:true,min:0}, currency:{type:String,required:true},
  destination:{type:Schema.Types.Mixed,required:true,select:false},
  recipientCode:String,
  status:{type:String,enum:["READY","SUBMITTING","PENDING","SUCCESS","FAILED","NEEDS_ATTENTION"],default:"READY",index:true},
  leaseUntil:Date, providerStatus:String, lastError:String,
},{timestamps:true}));

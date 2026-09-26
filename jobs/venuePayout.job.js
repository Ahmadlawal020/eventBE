const {CronJob}=require("cron");
const Payout=require("../models/client/venuePayout.schema");
const {processVenuePayout}=require("../services/venuePayout.service");
let running=false;
async function settleVenuePayouts(){
 if(running)return;running=true;
 try{
  const jobs=await Payout.find({status:{$in:["READY","SUBMITTING","PENDING"]},$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:new Date()}}]}).sort({updatedAt:1}).limit(100);
  for(const payout of jobs){
   try{await processVenuePayout(payout._id);}catch(error){console.error("[VENUE PAYOUT]",String(payout._id),error.message);}
  }
 }
 catch(error){console.error("[VENUE PAYOUT]",error.message);}finally{running=false;}
}
new CronJob("* * * * *",settleVenuePayouts,null,true);
module.exports={settleVenuePayouts};

/** Retained QA fixtures. Explicit live flags required; never deletes data. */
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
require("dotenv").config({quiet:true});
const mongoose=require("mongoose");mongoose.set("autoIndex",false);
const run="qa-"+new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14)+"-"+crypto.randomBytes(2).toString("hex");
const report={run,startedAt:new Date().toISOString(),mode:"retained live database / local API / no money movement",accounts:[],events:[],venues:[],bookings:[],checks:[],limitations:["Accounts are seeded with verified email; email delivery and signup OTP are not exercised.","Listing drafts are created through API, then fixture-only publication is applied for booking tests. Final listings are UNLISTED.","Venue passes are complimentary seeded fixtures, not real paid checkouts.","No deployed-server or mobile-camera UI tests; real route handlers, JWT middleware, database writes and QR validation are exercised locally.","No refunds, transfers, card charges, email or push delivery."]};
let reportDir,app,request;const tokens={};const owned=new Set();
const now=Date.now(),day=n=>new Date(now+n*86400000).toISOString().slice(0,10);
function save(){if(reportDir)fs.writeFileSync(path.join(reportDir,"report.json"),JSON.stringify(report,null,2));}
function record(name,pass,details){report.checks.push({name,pass,details});save();console.log((pass?"PASS ":"FAIL ")+name+(details?" "+JSON.stringify(details):""));}
async function api(name,method,url,role,body,expected=200){let req=request(app)[method](url);if(role)req=req.set("Authorization","Bearer "+tokens[role]);if(body!==undefined)req=req.send(body);const res=await req;const pass=(Array.isArray(expected)?expected:[expected]).includes(res.status);record(name,pass,{status:res.status,...(!pass?{message:res.body.message,errors:res.body.errors}:{})});return res;}
function required(res){if(res.status>=400)throw Error("Required step failed: "+res.status+" "+(res.body.message||""));return res.body.data;}
function own(id){assert.ok(owned.has(String(id)),"Only this run's records may be changed");}
async function main(){
 if(!process.argv.includes("--apply-live")||!process.argv.includes("--keep-data")){console.log("Plan: create 5 test accounts, 2 events, 3 venues, ticket tiers, staff invitations, free ticket purchases, complimentary venue passes, and test QR scans. Retain all data; leave listings unlisted. Run with --apply-live --keep-data --database <expected-name>.");return;}
 const expected=process.argv[process.argv.indexOf("--database")+1];assert.ok(process.argv.includes("--database")&&expected,"Expected database name is required");
 for(const key of ["DATABASE_URI","ACCESS_TOKEN_SECRET","REFRESH_TOKEN_SECRET","QR_SIGNING_SECRET"])assert.ok(process.env[key],key+" must be configured");
 reportDir=path.resolve(__dirname,"../../qa-reports",run);fs.mkdirSync(reportDir,{recursive:true});save();
 await mongoose.connect(process.env.DATABASE_URI,{autoIndex:false,serverSelectionTimeoutMS:20000});assert.equal(mongoose.connection.name,expected,"Database does not match explicit target");report.database=mongoose.connection.name;save();
 const hello=await mongoose.connection.db.admin().command({hello:1});assert.ok(hello.setName||hello.msg==="isdbgrid","Transactions required");
 // Disable only this process's outbound providers, before loading controllers.
 const email=require("../services/email.service");email.sendEmail=async()=>({suppressedForQA:true});
 const push=require("../services/notification/push.service");push.sendPushNotifications=async()=>({suppressedForQA:true});
 const Adapter=require("../services/payment/adapters/paystack.adapter");
 for(const method of ["initializePayment","verifyPayment","refundPayment","createTransferRecipient","transferToOrganiser","verifyTransfer","createVendorAccount","deactivateVendorAccount"])Adapter.prototype[method]=async()=>{throw Error("LIVE QA blocks external payment operations");};
 const express=require("express");request=require("supertest");app=express();app.use(express.json());
 for(const [prefix,file] of [["auth","auth"],["events","event"],["event-centers","eventCenter"],["event-tickets","eventTicketType"],["event-bookings","eventBooking"],["user-event-tickets","userEventTicket"],["event-center-tickets","eventCenterTicket"],["staff","staff"],["notifications","notification"]])app.use("/api/"+prefix,require("../routes/client/"+file+".route"));
 app.use((err,req,res,next)=>res.status(500).json({message:err.message}));
 const User=require("../models/client/user.schema"),Event=require("../models/client/event.schema"),Venue=require("../models/client/eventCenter.schema"),Ticket=require("../models/client/eventTicketType.schema"),Booking=require("../models/client/eventCenterBooking.schema"),UserTicket=require("../models/client/userEventTicket.schema"),Payout=require("../models/client/venuePayout.schema");
 const bcrypt=require("bcrypt");const password="Qa!"+crypto.randomBytes(18).toString("base64url");const hash=await bcrypt.hash(password,12);
 for(const role of ["organiser","buyer","guest","staff","unassigned_staff"]){
  const emailAddress=run+"."+role+"@example.com";
  const user=await User.create({firstName:"QA "+role,surname:run,email:emailAddress,password:hash,dob:new Date("1995-01-01"),roles:role==="organiser"?["user","organiser"]:role==="unassigned_staff"?["user","staff"]:["user"],isEmailVerified:true,emailVerifiedAt:new Date(),notificationPreferences:{channels:{email:false,push:false,sms:false}},pushTokens:[]});
  owned.add(String(user._id));report.accounts.push({role,id:String(user._id),email:emailAddress,password});save();
  const login=required(await api("Login "+role,"post","/api/auth/login",null,{email:emailAddress,password}));tokens[role]=login.accessToken;
 }
 const account=role=>report.accounts.find(a=>a.role===role);const label="[QA "+run.slice(-9)+"] ";
 const description="Retained QA fixture. Not a real listing. No payment is collected. Owner may inspect these records.";
 for(const title of ["Lifecycle Concert","Community Workshop"]){
  const data=required(await api("Create event "+title,"post","/api/events","organiser",{title:label+title,description,shortDescription:description,eventType:"COMMUNITY_LOCAL",schedule:{from:new Date(now+7*86400000),to:new Date(now+8*86400000)},location:{addressString:"QA test location, Lagos",city:"Lagos",country:"Nigeria"},ticketGuide:{refundPolicy:"QA free tickets only; no monetary transaction."},isDraft:true},201));
  const id=data._id||data.event?._id;assert.ok(id,"Event ID required");owned.add(String(id));report.events.push({id:String(id),title:label+title});save();own(id);await Event.updateOne({_id:id,createdBy:account("organiser").id},{$set:{status:"LISTED"}});
 }
 for(const [name,unit,mode] of [["Daily Hall","day","INSTANT"],["Hourly Studio","hour","INSTANT"],["Review Venue","day","REVIEW"]]){
  const data=required(await api("Create venue "+name,"post","/api/event-centers","organiser",{venueName:label+name,venueType:"MULTIPURPOSE_SPACE",description,shortDescription:description,location:{addressString:"QA test location, Lagos",city:"Lagos",country:"Nigeria"},basePrice:{amount:50000,currency:"NGN",unit,feeMode:"addon"},bookingSettings:mode,availability:{minDuration:1,maxDuration:30,bookingWindow:12,operationalHours:{open:"00:00",close:"24:00"}},isDraft:true},201));
  const id=data._id||data.eventCenter?._id;assert.ok(id,"Venue ID required");owned.add(String(id));report.venues.push({id:String(id),name:label+name,unit,mode});save();own(id);await Venue.updateOne({_id:id,createdBy:account("organiser").id},{$set:{status:"LISTED"}});
 }
 const listings=[...report.events.map(e=>({listingId:e.id,listingType:"Event"})),...report.venues.map(e=>({listingId:e.id,listingType:"EventCenter"}))];
 const invitation=required(await api("Organiser invites staff","post","/api/staff/invite","organiser",{staffEmail:account("staff").email,listings,permissions:["SCAN_TICKET","MANAGE_TICKETS","MANAGE_BOOKINGS"]},201));report.invitationId=invitation._id;save();
 required(await api("Staff accepts invitation","patch","/api/staff/respond/"+invitation._id,"staff",{action:"ACCEPTED"}));
 tokens.staff=required(await api("Refresh staff login after role assignment","post","/api/auth/login",null,{email:account("staff").email,password})).accessToken;
 const event=report.events[0];
 async function tier(name,quantity){const data=required(await api("Create "+name+" ticket tier","post","/api/event-tickets","organiser",{eventId:event.id,name:label+name,description,ticketType:"FREE",totalQuantity:quantity,perTransactionLimit:{min:1,max:5},salesStartAt:new Date(now-86400000),salesEndAt:new Date(now+5*86400000),currency:{code:"NGN",symbol:"NGN"}},201));return data._id||data.ticket?._id;}
 const free=await tier("Free Entry",20),limited=await tier("Last Seat",1);report.ticketTypes=[free,limited];save();
 const order=required(await api("Buyer purchases three free tickets","post","/api/event-bookings","buyer",{eventId:event.id,items:[{product:free,quantity:3}],paymentMethod:"FREE"}));assert.equal(order.tickets.length,3);report.eventOrder=order.booking._id;report.eventTickets=order.tickets.map(t=>({id:t._id,ticketNumber:t.ticketNumber,qrPayload:t.qrPayload}));save();
 const scanURL="/api/staff/scanner/event/"+event.id;
 await api("Unassigned staff cannot scan event","post",scanURL+"/validate","unassigned_staff",{qrPayload:order.tickets[0].qrPayload},403);
 await api("Tampered QR rejected","post",scanURL+"/validate","staff",{qrPayload:order.tickets[0].qrPayload+"x"},400);
 await api("Staff verifies event ticket","post",scanURL+"/verify","staff",{qrPayload:order.tickets[0].qrPayload});
 await api("Staff checks in event ticket","post",scanURL+"/validate","staff",{qrPayload:order.tickets[0].qrPayload});
 await api("Event duplicate scan rejected","post",scanURL+"/validate","staff",{qrPayload:order.tickets[0].qrPayload},409);
 await api("Ticket rejected at wrong event","post","/api/staff/scanner/event/"+report.events[1].id+"/validate","staff",{qrPayload:order.tickets[2].qrPayload},400);
 const races=await Promise.all(["buyer","guest"].map(role=>request(app).post("/api/event-bookings").set("Authorization","Bearer "+tokens[role]).send({eventId:event.id,items:[{product:limited,quantity:1}],paymentMethod:"FREE"})));
 record("Concurrent last-seat purchase allows one buyer",races.filter(r=>r.status===200).length===1&&races.filter(r=>r.status===409).length===1,{statuses:races.map(r=>r.status)});
 const scans=await Promise.all([1,2].map(()=>request(app).post(scanURL+"/validate").set("Authorization","Bearer "+tokens.staff).send({qrPayload:order.tickets[1].qrPayload})));
 record("Concurrent event scanning accepts once",scans.filter(r=>r.status===200).length===1&&scans.filter(r=>r.status===409).length===1,{statuses:scans.map(r=>r.status)});
 const {generateTicketNumber,generateQRPayload}=require("../utils/qr");
 // Complimentary fixtures never have a gateway reference or positive payout.
 for(const venue of report.venues){
  const number=generateTicketNumber("QA");const selectedDates=[{date:day(3),...(venue.unit==="hour"?{startTime:"10:00",endTime:"12:00"}:{})}];
  const b=await Booking.create({buyer:account("buyer").id,organiser:account("organiser").id,eventCenter:venue.id,guestDetails:{fullName:"QA complimentary guest "+run,email:account("buyer").email},selectedDates,bookingUnit:venue.unit,duration:venue.unit==="hour"?2:1,totalPrice:{amount:0,currency:"NGN"},subtotalPrice:{amount:0,currency:"NGN"},platformFeeAmount:0,organiserPayoutAmount:0,paymentStatus:"COMPLETED",bookingMode:venue.mode,status:venue.mode==="REVIEW"?"PENDING_REVIEW":"ACTIVE",reviewDeadline:venue.mode==="REVIEW"?new Date(now+86400000):undefined,ticketNumber:venue.mode==="REVIEW"?undefined:number,qrPayload:venue.mode==="REVIEW"?undefined:generateQRPayload(number,venue.id,"EVENT_CENTER"),payoutDestination:venue.mode==="REVIEW"?{accountName:"QA zero-value fixture",accountNumber:"NOT-A-BANK",bankCode:"QA"}:undefined});
  owned.add(String(b._id));report.bookings.push({id:String(b._id),venue:venue.name,complimentary:true});save();
  const field=venue.unit==="day"?"unavailableDates":"unavailableSlots";await Venue.updateOne({_id:venue.id,createdBy:account("organiser").id},{$push:{["availability."+field]:{$each:selectedDates.map(d=>({...d,type:"BOOKED",bookingId:String(b._id)}))}}});
  if(venue.mode==="REVIEW"){
   await api("Unrelated user cannot approve venue","post","/api/event-center-tickets/"+b._id+"/accept","guest",{},403);
   required(await api("Organiser approves complimentary review booking","post","/api/event-center-tickets/"+b._id+"/accept","organiser",{}));
   const payout=await Payout.findOne({booking:b._id});record("Complimentary review queues no money transfer",payout?.amountMinor===0&&payout?.status==="SUCCESS",{amountMinor:payout?.amountMinor,status:payout?.status});
   await api("Repeated approval is harmless","post","/api/event-center-tickets/"+b._id+"/accept","organiser",{});
  }
  const current=await Booking.findById(b._id);Object.assign(report.bookings.at(-1),{ticketNumber:current.ticketNumber,qrPayload:current.qrPayload});save();
  const url="/api/staff/scanner/event-center/"+venue.id;
  await api("Verify pass: "+venue.name,"post",url+"/verify","staff",{qrPayload:current.qrPayload});
  await api("Check in pass: "+venue.name,"post",url+"/validate","staff",{qrPayload:current.qrPayload});
  await api("Reject duplicate pass: "+venue.name,"post",url+"/validate","staff",{qrPayload:current.qrPayload},409);
 }
 await api("Buyer retrieves their event orders","get","/api/event-bookings/my-bookings","buyer");
 await api("Buyer retrieves venue passes","get","/api/event-center-tickets/my-tickets","buyer");
 const retained=await UserTicket.find({bookingId:report.eventOrder}).select("ticketNumber status checkIn").lean();report.finalEventTickets=retained;
 record("Unused event ticket retained for manual scanning",retained.some(t=>t.status==="UNREDEEMED"));
 report.finishedAt=new Date().toISOString();save();
}
main().catch(error=>{report.error=error.message;record("Lifecycle run completed",false,{error:error.message});process.exitCode=1;}).finally(async()=>{
 if(mongoose.connection.readyState===1){
  const Event=require("../models/client/event.schema"),Venue=require("../models/client/eventCenter.schema");
  for(const item of report.events){own(item.id);await Event.updateOne({_id:item.id},{$set:{status:"UNLISTED"}});}
  for(const item of report.venues){own(item.id);await Venue.updateOne({_id:item.id},{$set:{status:"UNLISTED"}});}
  report.finalListingStatus="UNLISTED";await mongoose.disconnect();
 }
 report.summary={passed:report.checks.filter(c=>c.pass).length,failed:report.checks.filter(c=>!c.pass).length};save();
 if(reportDir){console.log("REPORT "+path.join(reportDir,"report.json"));console.log("SUMMARY "+JSON.stringify(report.summary));}
});

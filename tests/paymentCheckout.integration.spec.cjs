process.env.NODE_ENV="test";
// Real transactions against a temporary replica set, never the application DB.
process.env.QR_SIGNING_SECRET="payment-integration-test-only";
process.env.PAYSTACK_SUPPORTED_CURRENCIES="NGN";
const {test,before,after,beforeEach,afterEach,mock}=require("node:test");
const assert=require("node:assert/strict");
const mongoose=require("mongoose");
const {MongoMemoryReplSet}=require("mongodb-memory-server");
const Event=require("../models/client/event.schema");
const Ticket=require("../models/client/eventTicketType.schema");
const User=require("../models/client/user.schema");
const Venue=require("../models/client/eventCenter.schema");
const EventBooking=require("../models/client/eventBooking.schema");
const Booking=require("../models/client/eventCenterBooking.schema");
const UserTicket=require("../models/client/userEventTicket.schema");
const Payout=require("../models/client/venuePayout.schema");
const {reserveEventBooking,completePayment,expireEventReservation}=require("../services/checkoutSafety.service");
const {confirmReviewBooking}=require("../services/venuePayout.service");
const Refund=require("../models/client/eventRefund.schema");
const Attempts=require("../models/client/refundUploadAttempt.schema");
const Audit=require("../models/management/adminAuditLog.schema");
const Health=require("../models/client/refundWorkerHealth.schema");
const Outbox=require("../models/client/notificationOutbox.schema");
const cancellationController=require("../controllers/client/eventCancellation.controller");
const refundController=require("../controllers/client/eventRefund.controller");
const Media=require("../models/client/eventMedia.schema");
const VoidReview=require("../models/client/ticketVoidReview.schema");
let repl,owner,buyer,event,venue,ticket;
const oid=()=>new mongoose.Types.ObjectId();
const date=new Date(Date.now()+86400000*2).toISOString().slice(0,10);
before(async()=>{
 repl=await MongoMemoryReplSet.create({replSet:{count:1}});
 await mongoose.connect(repl.getUri(),{dbName:"isolated_payment_checkout"});
 await Promise.all([EventBooking,Booking,UserTicket,Payout,Ticket,Refund,Outbox,Attempts,Audit,Health,Media,VoidReview,require("../models/client/otp.schema"),require("../models/client/ticketTransferRequest.schema")].map(model=>model.init()));
},{timeout:180000});
after(async()=>{await mongoose.disconnect();if(repl)await repl.stop();});
afterEach(()=>mock.restoreAll());
beforeEach(async()=>{
 assert.ok(repl,"Only the isolated test replica set may be cleared");
 for(const collection of Object.values(mongoose.connection.collections))await collection.deleteMany({});
 owner=oid();buyer=oid();event=oid();venue=oid();ticket=oid();
 await User.collection.insertMany([{_id:owner,firstName:"Host",surname:"Test",email:"host@example.com",bankDetails:{accountName:"Host",accountNumber:"0000000000",bankCode:"000"}},{_id:buyer,firstName:"Guest",surname:"Test",email:"guest@example.com"}]);
 await Event.collection.insertOne({_id:event,createdBy:owner,title:"Payment Test",status:"LISTED",schedule:{from:new Date(date),to:new Date(date)}});
 await Ticket.collection.insertOne({_id:ticket,eventId:event,name:"Standard",ticketType:"PAID",price:{amountCents:10000},currency:{code:"NGN",symbol:"NGN"},totalQuantity:10,soldQuantity:0});
 await Venue.collection.insertOne({_id:venue,createdBy:owner,venueName:"Payment Test",status:"LISTED",bookingSettings:"REVIEW",basePrice:{amount:10000,unit:"day",currency:"NGN"},availability:{unavailableDates:[],unavailableSlots:[]}});
});
const paid=(reference,amount)=>({reference,amount,currency:"NGN",status:"success"});
const eventData=(reference="event-payment")=>({eventId:event,buyer,items:[{ticketId:ticket,name:"Standard",quantity:2,pricePerUnit:10000,totalPrice:20000}],subtotalAmount:20000,totalAmount:20000,currency:"NGN",paymentMethod:"CARD",paymentStatus:"PENDING",paymentReference:reference});
const venueBooking=(reference,extra={})=>Booking.create({buyer,organiser:owner,eventCenter:venue,selectedDates:[{date}],bookingUnit:"day",duration:1,totalPrice:{amount:11500,currency:"NGN"},organiserPayoutAmount:10000,platformFeeAmount:1500,paymentReference:reference,paymentStatus:"PENDING",bookingMode:"REVIEW",payoutDestination:{accountName:"Host",accountNumber:"0000000000",bankCode:"000"},...extra});

test("multi-item inventory reservation rolls back when a later item is sold out",async()=>{
 const other=oid();await Ticket.collection.insertOne({_id:other,totalQuantity:0,soldQuantity:0});const data=eventData();data.items.push({ticketId:other,name:"Sold out",quantity:1,pricePerUnit:100,totalPrice:100});await assert.rejects(reserveEventBooking(data),/availability or pricing|Not enough/);assert.equal((await Ticket.findById(ticket)).soldQuantity,0);assert.equal(await EventBooking.countDocuments(),0);
});
test("concurrent webhook and client completion produce one set of event tickets",async()=>{
 const saved=await reserveEventBooking(eventData());await Promise.all([completePayment(saved.paymentReference,paid(saved.paymentReference,20000)),completePayment(saved.paymentReference,paid(saved.paymentReference,20000))]);assert.equal(await UserTicket.countDocuments({bookingId:saved._id}),2);assert.equal((await Ticket.findById(ticket)).soldQuantity,2);assert.equal((await EventBooking.findById(saved._id)).paymentStatus,"COMPLETED");
});
test("concurrent venue payments cannot reserve the same date twice",async()=>{
 const first=await venueBooking("venue-first"),second=await venueBooking("venue-second");const results=await Promise.all([first,second].map(saved=>completePayment(saved.paymentReference,paid(saved.paymentReference,1150000),{kind:"EVENT_CENTER"})));assert.equal(results.filter(result=>result.conflict).length,1);assert.equal((await Venue.findById(venue)).availability.unavailableDates.length,1);assert.equal(await Booking.countDocuments({paymentResolutionRequired:true}),1);
});
test("concurrent approval queues one payout and no payout exists before approval",async()=>{
 const saved=await venueBooking("venue-review");await completePayment(saved.paymentReference,paid(saved.paymentReference,1150000),{kind:"EVENT_CENTER"});assert.equal(await Payout.countDocuments(),0);await Promise.all([confirmReviewBooking(saved._id,owner),confirmReviewBooking(saved._id,owner)]);assert.equal(await Payout.countDocuments({booking:saved._id}),1);assert.equal((await Payout.findOne({booking:saved._id})).amountMinor,1000000);assert.equal((await Booking.findById(saved._id)).status,"CONFIRMED");
});
test("approval and decline cannot both win the review transition",async()=>{
 const saved=await venueBooking("venue-review-race");await completePayment(saved.paymentReference,paid(saved.paymentReference,1150000),{kind:"EVENT_CENTER"});await Promise.allSettled([confirmReviewBooking(saved._id,owner),Booking.findOneAndUpdate({_id:saved._id,status:"PENDING_REVIEW"},{$set:{status:"CANCELLED"}},{new:true})]);const current=await Booking.findById(saved._id);assert.ok(["CONFIRMED","CANCELLED"].includes(current.status));assert.equal(await Payout.countDocuments({booking:saved._id}),current.status==="CONFIRMED"?1:0);
});
test("concurrent expiry releases inventory once and late payment cannot issue tickets",async()=>{
 const saved=await reserveEventBooking(eventData());await EventBooking.updateOne({_id:saved._id},{$set:{reservationExpiresAt:new Date(0)}});await Promise.all([expireEventReservation(saved._id),expireEventReservation(saved._id)]);assert.equal((await Ticket.findById(ticket)).soldQuantity,0);const result=await completePayment(saved.paymentReference,paid(saved.paymentReference,20000));assert.equal(result.conflict,true);assert.equal(await UserTicket.countDocuments(),0);assert.equal((await EventBooking.findById(saved._id)).status,"CANCELLED");
});
test("failed free-ticket generation rolls back the booking and inventory",async()=>{
 const controller=require("../controllers/client/userEventTicket.controller");mock.method(controller,"createTicketsForBooking",async()=>{throw Error("ticket insert failed")});await assert.rejects(reserveEventBooking({...eventData(),paymentMethod:"FREE",paymentStatus:"COMPLETED",totalAmount:0}),/ticket insert failed/);assert.equal((await Ticket.findById(ticket)).soldQuantity,0);assert.equal(await EventBooking.countDocuments(),0);
});

const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
const cancel=async()=>{const res=response();await cancellationController.cancelEvent({params:{id:String(event)},user:{id:String(owner)},body:{message:"Venue unavailable",confirm:true}},res);assert.equal(res.code,200,JSON.stringify(res.body));return res;};
test("late successful payment after cancellation creates ticket refunds and no usable tickets",async()=>{
 const saved=await reserveEventBooking(eventData());await cancel();
 await Promise.all([1,2].map(()=>completePayment(saved.paymentReference,paid(saved.paymentReference,20000))));
 assert.equal(await UserTicket.countDocuments({status:{$ne:"CANCELLED"}}),0);assert.equal(await Refund.countDocuments(),2);
 assert.equal((await Refund.findOne()).amountMinor,10000);assert.equal(await Outbox.countDocuments(),2);
});
test("payment and cancellation race preserves every paid booking's refund",async()=>{
 const saved=await reserveEventBooking(eventData());
 await Promise.all([cancel(),completePayment(saved.paymentReference,paid(saved.paymentReference,20000))]);
 assert.equal((await Event.findById(event)).status,"CANCELLED");
 assert.equal(await UserTicket.countDocuments({status:{$ne:"CANCELLED"}}),0);
 assert.equal(await Refund.countDocuments({bookingId:saved._id}),2);
});
test("buyer details, proof, mark paid, dispute and confirmation form an authorised cycle",async()=>{
 const saved=await reserveEventBooking(eventData());await completePayment(saved.paymentReference,paid(saved.paymentReference,20000));await cancel();
 let refund=await Refund.findOne();
 const call=async(method,user,body={})=>{const res=response();await lifecycle[method]({params:{refundId:String(refund._id)},user:{id:String(user)},body:{settlementId:"fixture-settlement",...body}},res);return res;};
 assert.equal((await call("submitBankDetails",buyer,{accountName:"Buyer",accountNumber:"bad",bankCode:"058"})).code,400);
 assert.equal((await call("submitBankDetails",owner,{accountName:"Buyer",accountNumber:"0123456789",bankCode:"058"})).code,409);
 assert.equal((await call("submitBankDetails",buyer,{accountName:"Buyer",accountNumber:"0123456789",bankCode:"058"})).code,200);
 assert.equal((await call("markRefundPaid",owner)).code,409);
 await Refund.updateOne({_id:refund._id},{$set:{receipt:{publicId:"test-proof",format:"png",uploadedAt:new Date(),settlementId:"fixture-settlement"},settlement:{id:"fixture-settlement",bankDetailsVersion:1}}});
 assert.equal((await call("markRefundPaid",owner)).code,200);
 assert.equal((await call("markRefundPaid",owner)).code,409);
 assert.equal((await call("submitBankDetails",buyer,{accountName:"Changed",accountNumber:"0123456789",bankCode:"058"})).code,409);
 assert.equal((await call("disputeRefund",buyer)).code,200);
 assert.equal((await call("confirmRefund",buyer)).code,200);
 assert.equal((await call("confirmRefund",buyer)).code,409);
 refund=await Refund.findOne().select("+managementCase");assert.equal(refund.status,"CONFIRMED_BY_BUYER");assert.equal(refund.managementCase.status,"RESOLVED");
});

test("overdue transitions queue buyer and organiser reminders once for each stage",async()=>{
 const refund=await Refund.create({eventId:event,bookingId:oid(),ticketId:oid(),buyer,organiser:owner,amountMinor:1000,currency:"NGN",dueAt:new Date(0)});
 const {markOverdueEventRefunds}=require("../jobs/eventRefundOverdue.job");
 assert.equal((await markOverdueEventRefunds()).modifiedCount,1);assert.equal(await Outbox.countDocuments(),2);
 assert.equal((await markOverdueEventRefunds()).modifiedCount,0);assert.equal(await Outbox.countDocuments(),2);
 await Refund.updateOne({_id:refund._id},{$set:{status:"MARKED_PAID",markedPaidAt:new Date(),confirmationDueAt:new Date(0)}});
 assert.equal((await markOverdueEventRefunds()).modifiedCount,1);assert.equal(await Outbox.countDocuments(),4);
 assert.ok((await Refund.findById(refund._id)).markedPaidAt);
});

test("undo check-in racing with cancellation never revives an active ticket",async()=>{
 const saved=await reserveEventBooking(eventData());await completePayment(saved.paymentReference,paid(saved.paymentReference,20000));
 const ticketDoc=await UserTicket.findOne();await UserTicket.updateOne({_id:ticketDoc._id},{$set:{status:"REDEEMED"}});
 const res=response();await Promise.all([cancel(),require("../controllers/client/userEventTicket.controller").uncheckInTicket({body:{ticketNumber:ticketDoc.ticketNumber},user:{id:String(owner)}},res)]);
 assert.ok([200,400,409].includes(res.code));
 assert.equal(await UserTicket.countDocuments({status:"UNREDEEMED"}),0);
});

test("outbox persistence failure rolls back cancellation, ticket invalidation and refunds",async()=>{
 const saved=await reserveEventBooking(eventData());await completePayment(saved.paymentReference,paid(saved.paymentReference,20000));
 mock.method(Outbox,"bulkWrite",async()=>{throw Error("simulated outbox failure");});
 const res=response();await cancellationController.cancelEvent({params:{id:String(event)},user:{id:String(owner)},body:{message:"Venue unavailable",confirm:true}},res);
 assert.equal(res.code,500);assert.equal((await Event.findById(event)).status,"LISTED");
 assert.equal(await Refund.countDocuments(),0);assert.equal(await UserTicket.countDocuments({status:"CANCELLED"}),0);
});

test("moderation cannot restore an event with cancellation obligations",async()=>{
 await Event.updateOne({_id:event},{$set:{status:"CANCELLED","moderation.reviewedAt":new Date()}});
 const res=response();await require("../controllers/management/moderation.controller").decide({params:{type:"event",id:String(event)},user:{id:String(owner)},body:{decision:"APPROVED",updatedAt:new Date().toISOString()}},res,error=>{throw error;});
 assert.equal(res.code,409);assert.equal((await Event.findById(event)).status,"CANCELLED");
});
test("deletion preserves purchased drafts and only deletes unused drafts",async()=>{
 const saved=await reserveEventBooking(eventData());await Event.updateOne({_id:event},{$set:{status:"IN_PROGRESS"}});
 const controller=require("../controllers/client/event.controller");
 const req={params:{id:String(event)},user:{id:String(owner)}};const denied=response();await controller.deleteEvent(req,denied);assert.equal(denied.code,409);assert.ok(await Event.findById(event));assert.ok(await Ticket.findById(ticket));
 // Remove only the isolated fixture booking to exercise an unused draft.
 await EventBooking.deleteOne({_id:saved._id});const allowed=response();await controller.deleteEvent(req,allowed);assert.equal(allowed.code,200);assert.equal(await Event.findById(event),null);assert.equal(await Ticket.findById(ticket),null);
});

test("buyer can submit spaced account numbers when legacy payment timestamps are null",async()=>{
 const refund=await Refund.create({eventId:event,bookingId:oid(),ticketId:oid(),buyer,organiser:owner,amountMinor:1000,currency:"NGN",dueAt:new Date(),markedPaidAt:null,receipt:{uploadedAt:null}});
 const res=response();await refundController.submitBankDetails({params:{refundId:String(refund._id)},user:{id:String(buyer)},body:{accountName:" Buyer ",accountNumber:"0123 456-789",bankCode:"058"}},res);
 assert.equal(res.code,200,JSON.stringify(res.body));const saved=await Refund.findById(refund._id).select("+bankDetails.accountNumber");assert.equal(saved.bankDetails.accountNumber,"0123456789");assert.equal(saved.status,"DUE_FROM_ORGANISER");assert.equal(saved.markedPaidAt,undefined);
});

test("transferred tickets assign refunds to current holders and deny the giver access",async()=>{
 const saved=await reserveEventBooking(eventData());await completePayment(saved.paymentReference,paid(saved.paymentReference,20000));
 const recipient=oid();await User.collection.insertOne({_id:recipient,firstName:"Gift recipient",email:"gift@example.test"});
 const gifted=await UserTicket.findOne();await UserTicket.updateOne({_id:gifted._id},{$set:{owner:recipient}});
 await cancel();
 const refund=await Refund.findOne({ticketId:gifted._id});assert.equal(String(refund.buyer),String(recipient));assert.equal(refund.amountMinor,10000);
 assert.equal((await Refund.find({bookingId:saved._id})).reduce((sum,row)=>sum+row.amountMinor,0),20000);
 const req=user=>({params:{refundId:String(refund._id)},user:{id:String(user)},body:{accountName:"Holder",accountNumber:"0123456789",bankCode:"058"}});
 const denied=response();await refundController.submitBankDetails(req(buyer),denied);assert.equal(denied.code,409);
 const allowed=response();await refundController.submitBankDetails(req(recipient),allowed);assert.equal(allowed.code,200);
 const mine=response();await refundController.getMyRefunds({user:{id:String(buyer)}},mine);assert.equal(mine.body.data.length,1);assert.notEqual(String(mine.body.data[0].ticketId),String(gifted._id));
 await Refund.updateOne({_id:refund._id},{$set:{receipt:{publicId:"gift-proof",format:"png",uploadedAt:new Date()}}});
 const receipt=require("../controllers/client/eventRefundReceipt.controller");const hidden=response();await receipt.getReceipt(req(buyer),hidden);assert.equal(hidden.code,404);
});
test("legacy unpaid refunds split by holder without carrying the giver bank details to a gift",async()=>{
 const saved=await reserveEventBooking(eventData());await completePayment(saved.paymentReference,paid(saved.paymentReference,20000));
 const gifted=await UserTicket.findOne();const recipient=oid();await UserTicket.updateOne({_id:gifted._id},{$set:{owner:recipient,status:"CANCELLED"}});
 const legacy=await Refund.create({eventId:event,bookingId:saved._id,buyer,organiser:owner,amountMinor:20000,currency:"NGN",dueAt:new Date(),status:"DUE_FROM_ORGANISER",bankDetails:{accountName:"Giver",accountNumber:"0123456789",bankCode:"058"}});
 const {migrateLegacyRefund}=require("../services/migrateTicketRefunds.service");assert.equal(await migrateLegacyRefund(legacy._id),2);
 const gift=await Refund.findOne({ticketId:gifted._id}).select("+bankDetails.accountNumber");assert.equal(String(gift.buyer),String(recipient));assert.equal(gift.bankDetails?.accountNumber,undefined);assert.equal(gift.status,"AWAITING_BUYER_DETAILS");
 assert.equal(await migrateLegacyRefund(legacy._id),0);
 assert.ok(await mongoose.connection.collection("eventrefund_holder_migration_backups").findOne({_id:legacy._id}));
});

test("migration does not reassign receipts already recorded for the giver",async()=>{
 const saved=await reserveEventBooking(eventData());await completePayment(saved.paymentReference,paid(saved.paymentReference,20000));
 await UserTicket.updateOne({bookingId:saved._id},{$set:{owner:oid()}});
 const legacy=await Refund.create({eventId:event,bookingId:saved._id,buyer,organiser:owner,amountMinor:20000,currency:"NGN",dueAt:new Date(),status:"MARKED_PAID",markedPaidAt:new Date(),receipt:{publicId:"proof",format:"png",uploadedAt:new Date()}});
 await assert.rejects(require("../services/migrateTicketRefunds.service").migrateLegacyRefund(legacy._id),/manual settlement review/);
 assert.equal(await Refund.countDocuments(),1);assert.equal((await Refund.findById(legacy._id)).ticketId,undefined);
});
test("transfer racing with cancellation assigns the refund to the final ticket owner",async()=>{
 const saved=await reserveEventBooking(eventData());await completePayment(saved.paymentReference,paid(saved.paymentReference,20000));const target=await UserTicket.findOne();
 await Promise.all([cancel(),UserTicket.findOneAndUpdate({_id:target._id,status:"UNREDEEMED"},{$set:{owner:oid()}})]);
 const current=await UserTicket.findById(target._id);const refund=await Refund.findOne({ticketId:target._id});assert.equal(String(refund.buyer),String(current.owner));
});


test("mark paid rejects incomplete bank details and missing proof, accepts null unpaid timestamp once", async () => {
 const base = {eventId:event,bookingId:oid(),ticketId:oid(),buyer,organiser:owner,amountMinor:1000,currency:"NGN",dueAt:new Date(),status:"DUE_FROM_ORGANISER",markedPaidAt:null,
 bankDetails:{accountName:"Holder",accountNumber:"0123456789",bankCode:"058"},settlement:{id:"fixture-settlement",bankDetailsVersion:0},receipt:{publicId:"proof",format:"png",uploadedAt:new Date(),settlementId:"fixture-settlement"}};
 const refund = await Refund.create(base);
 const mark = async () => {const res=response();await refundController.markRefundPaid({params:{refundId:String(refund._id)},user:{id:String(owner)},body:{settlementId:"fixture-settlement"}},res);return res;};
 for (const field of ["bankDetails.accountNumber","bankDetails.bankCode","receipt.publicId","receipt.uploadedAt"]) {
  await Refund.updateOne({_id:refund._id},{$unset:{[field]:1}});
  assert.equal((await mark()).code,409,field);
  assert.equal(await Outbox.countDocuments(),0);
  await Refund.updateOne({_id:refund._id},{$set:{bankDetails:base.bankDetails,receipt:base.receipt}});
 }
 await Refund.updateOne({_id:refund._id},{$set:{"receipt.uploadedAt":null}});
 assert.equal((await mark()).code,409);
 await Refund.updateOne({_id:refund._id},{$set:{receipt:base.receipt}});
 const results=await Promise.all([mark(),mark()]);
 assert.deepEqual(results.map(r=>r.code).sort(),[200,409]);
 assert.equal(await Outbox.countDocuments(),1);
});


const newRefund = (extra={}) => Refund.create({settlement:{id:"fixture-settlement",bankDetailsVersion:0,preparedAt:new Date(),preparedBy:owner},eventId:event,bookingId:oid(),ticketId:oid(),buyer,organiser:owner,amountMinor:1000,currency:"NGN",dueAt:new Date(0),status:"DUE_FROM_ORGANISER",bankDetails:{accountName:"Holder",accountNumber:"0123456789",bankCode:"058"},...extra});
test("support recovery preserves evidence, requires holder request and staff attestation, and never reopens paid refunds",async()=>{
 const controller=require("../controllers/client/refundSupport.controller");
 const refund=await newRefund({receipt:{publicId:"archived-proof",format:"png",uploadedAt:new Date()}});
 const support=async(user)=>{const res=response();await controller.requestSupport({params:{refundId:String(refund._id)},user:{id:String(user)},body:{reason:"Incorrect bank account"}},res);return res;};
 assert.equal((await support(owner)).code,409);assert.equal((await support(buyer)).code,200);assert.equal((await support(buyer)).code,409);
 const recover=async(confirmNoPayment)=>{const res=response();await controller.recoverUnpaidRefund({params:{id:String(refund._id)},user:{id:String(oid())},body:{reason:"Verified with organiser",confirmNoPayment}},res);return res;};
 assert.equal((await recover(false)).code,400);assert.equal((await recover(true)).code,200);
 const saved=await Refund.findById(refund._id).select("+recoveryHistory +receipt.publicId +bankDetails.accountNumber");
 assert.equal(saved.recoveryHistory[0].receipt.publicId,"archived-proof");assert.equal(saved.recoveryHistory[0].bankDetails.accountNumber,"0123456789");assert.equal(saved.receipt?.publicId,undefined);assert.equal(saved.bankDetails?.accountNumber,undefined);
 assert.equal(await Audit.countDocuments({action:"REOPEN_UNPAID_EVENT_REFUND"}),1);
 await Refund.updateOne({_id:refund._id},{$set:{status:"MARKED_PAID",markedPaidAt:new Date(),"supportRequest.status":"OPEN"}});
 assert.equal((await recover(true)).code,409);
});
test("recovery audit failure rolls back the refund and all notices",async()=>{
 const refund=await newRefund({supportRequest:{status:"OPEN",reason:"Wrong account",requestedAt:new Date()}});
 mock.method(Audit,"create",async()=>{throw Error("audit unavailable")});
 const res=response();await require("../controllers/client/refundSupport.controller").recoverUnpaidRefund({params:{id:String(refund._id)},user:{id:String(oid())},body:{reason:"Correction",confirmNoPayment:true}},res);
 assert.equal(res.code,500);assert.equal((await Refund.findById(refund._id)).status,"DUE_FROM_ORGANISER");assert.equal(await Outbox.countDocuments(),0);
});
test("expired upload cleanup deletes only unattached assets and preserves current and archived proof",async()=>{
 const cloud=require("../utils/cloudinary"),destroyed=[];
 mock.method(cloud.uploader,"destroy",async id=>{destroyed.push(id);return {result:"ok"}});
 const refund=await newRefund({receipt:{publicId:"current",format:"png",uploadedAt:new Date()},recoveryHistory:[{receipt:{publicId:"archived"}}],pendingReceiptPublicId:"abandoned"});
 for(const publicId of ["current","archived","abandoned"])await Attempts.create({publicId,refundId:refund._id,organiser:owner,expiresAt:new Date(0),cleanupAfter:new Date(0)});
 const result=await require("../services/refundUploadCleanup.service").cleanupRefundUploads();
 assert.equal(result.deleted,1);assert.deepEqual(destroyed,["abandoned"]);assert.equal((await Refund.findById(refund._id).select("+pendingReceiptPublicId")).pendingReceiptPublicId,undefined);
});
test("direct upload attempt is attached transactionally and expired completion cannot attach",async()=>{
 const cloud=require("../utils/cloudinary");
 mock.method(cloud,"config",()=>({cloud_name:"test",api_key:"test",api_secret:"test"}));
 mock.method(cloud.utils,"api_sign_request",()=>"test-signature");
 mock.method(cloud.api,"resource",async()=>({type:"authenticated",resource_type:"image",format:"png",bytes:100}));
 const refund=await newRefund();const controller=require("../controllers/client/eventRefundReceipt.controller");
 const call=async(method,body={})=>{const res=response();await controller[method]({params:{refundId:String(refund._id)},user:{id:String(owner)},body},res);return res;};
 const first=await call("prepareReceiptUpload",{settlementId:"fixture-settlement"});assert.equal(first.code,200);const publicId=first.body.data.parameters.public_id;
 assert.equal((await call("completeReceiptUpload",{publicId,settlementId:"fixture-settlement"})).code,200);assert.equal((await Attempts.findOne({publicId})).state,"ATTACHED");
 assert.equal((await call("completeReceiptUpload",{publicId,settlementId:"fixture-settlement"})).code,200);
 const second=await call("prepareReceiptUpload",{settlementId:"fixture-settlement"});const expired=second.body.data.parameters.public_id;
 await Attempts.updateOne({publicId:expired},{$set:{expiresAt:new Date(0)}});
 assert.equal((await call("completeReceiptUpload",{publicId:expired,settlementId:"fixture-settlement"})).code,409);
 assert.equal((await Refund.findById(refund._id).select("+receipt.publicId")).receipt.publicId,publicId);
});
test("refund workspace paginates whole holders, filters on server and excludes private bank data",async()=>{
 const saved=await reserveEventBooking(eventData());await completePayment(saved.paymentReference,paid(saved.paymentReference,20000));await cancel();
 const second=oid();await User.collection.insertOne({_id:second,firstName:"Gift",surname:"Receiver",email:"gift+test@example.test"});
 const target=await UserTicket.findOne();await UserTicket.updateOne({_id:target._id},{$set:{owner:second}});await Refund.updateOne({ticketId:target._id},{$set:{buyer:second,status:"MARKED_PAID",markedPaidAt:new Date(),bankDetails:{accountName:"Gift",accountNumber:"0123456789",bankCode:"058"}}});
 const controller=require("../controllers/client/refundWorkspace.controller");
 const call=async(method,query={},user=owner)=>{const res=response();await controller[method]({params:{id:String(event)},user:{id:String(user)},query},res);return res;};
 const summary=await call("summary");assert.equal(summary.code,200,JSON.stringify(summary.body));assert.equal(summary.body.data.tiers[0].total,2);assert.equal(summary.body.data.tiers[0].holders,2);assert.equal(summary.body.data.tiers[0].sent,1);
 const page=await call("holders",{ticketTypeId:String(ticket),limit:"1"});assert.equal(page.code,200,JSON.stringify(page.body));assert.equal(page.body.data.total,2);assert.equal(page.body.data.items.length,1);assert.ok(!JSON.stringify(page.body).includes("0123456789"));
 const filtered=await call("holders",{ticketTypeId:String(ticket),filter:"sent",search:"gift+test"});assert.equal(filtered.body.data.total,1);assert.equal(String(filtered.body.data.items[0]._id),String(second));
 const detail=await call("holderTickets",{ticketTypeId:String(ticket),holderId:String(second)});assert.equal(detail.body.data.tickets.length,1);assert.equal(detail.body.data.refunds[0].bankDetails.accountNumber,"0123456789");
 assert.equal((await call("summary",{},buyer)).code,404);assert.equal((await call("holders",{ticketTypeId:String(ticket),limit:"1000"})).code,400);
});
test("overdue job isolates individual record failures and operations health exposes failures",async()=>{
 const first=await newRefund(),second=await newRefund();const original=Refund.findOneAndUpdate.bind(Refund);
 mock.method(Refund,"findOneAndUpdate",(filter,...args)=>String(filter._id)===String(first._id)?Promise.reject(Error("bad record")):original(filter,...args));
 const result=await require("../jobs/eventRefundOverdue.job").markOverdueEventRefunds();assert.equal(result.modifiedCount,1);assert.equal(result.failedCount,1);assert.equal((await Refund.findById(second._id)).status,"OVERDUE");
 await Outbox.create({key:"failed",recipient:buyer,type:"SYSTEM",title:"Failed",message:"Test",failedAt:new Date()});
 const health=await require("../services/refundOperations.service").getRefundOperations();assert.equal(health.failed,1);assert.ok(health.alerts.some(a=>a.includes("heartbeat")));
});

test("large holder lists return bounded pages and event-wide totals",async()=>{
 const rows=Array.from({length:1000},(_,index)=>({_id:oid(),eventId:event,ticketTypeId:ticket,owner:oid(),ticketName:"Standard",ticketNumber:`LOAD-${index}`,status:"CANCELLED",ticketSnapshot:{ticketType:"FREE",price:{amount:0}}}));
 await UserTicket.collection.insertMany(rows);
 const controller=require("../controllers/client/refundWorkspace.controller");
 const req={params:{id:String(event)},user:{id:String(owner)},query:{ticketTypeId:String(ticket),limit:"25",filter:"none",page:"2"}};
 const page=response();await controller.holders(req,page);assert.equal(page.code,200,JSON.stringify(page.body));assert.equal(page.body.data.total,1000);assert.equal(page.body.data.items.length,25);
 const summary=response();await controller.summary(req,summary);assert.equal(summary.body.data.tiers[0].total,1000);assert.equal(summary.body.data.tiers[0].pending,0);
});

test("manual notification retry preserves sent channels and writes an audit record",async()=>{
 const notice=await Outbox.create({key:"manual-retry",recipient:buyer,type:"SYSTEM",title:"Notice",message:"Test",failedAt:new Date(),inAppSentAt:new Date(),attempts:12});
 const res=response();await require("../controllers/management/refundOperations.controller").retryNotice({params:{noticeId:String(notice._id)},user:{id:String(oid())}},res);
 assert.equal(res.code,200);const saved=await Outbox.findById(notice._id);assert.equal(saved.failedAt,null);assert.equal(saved.attempts,0);assert.ok(saved.inAppSentAt);assert.equal(await Audit.countDocuments({action:"RETRY_REFUND_NOTICE"}),1);
});


async function issueForLifecycle() { const booking=await reserveEventBooking(eventData());await completePayment(booking.paymentReference,paid(booking.paymentReference,20000));return UserTicket.findOne(); }
test("event check-in is atomic across simultaneous scanners and closes at completion",async()=>{
 const issued=await issueForLifecycle();const service=require("../services/eventEntry.service");
 const attempts=await Promise.all([1,2].map(()=>service.checkInEventTicket({eventId:event,ticketNumber:issued.ticketNumber,actor:owner})));
 assert.equal(attempts.filter(Boolean).length,1);
 const unused=await UserTicket.findOne({status:"UNREDEEMED"});await Event.updateOne({_id:event},{$set:{status:"COMPLETED"}});
 await assert.rejects(service.checkInEventTicket({eventId:event,ticketNumber:unused.ticketNumber,actor:owner}),/Entry is closed/);
 assert.equal((await UserTicket.findById(unused._id)).status,"UNREDEEMED");
});
test("staff check-in enforces scan permission and cannot revive cancelled tickets",async()=>{
 const issued=await issueForLifecycle(),staff=oid();const Invitation=require("../models/client/staffInvitation.schema");
 await Invitation.collection.insertOne({staff,organiser:owner,status:"ACCEPTED",permissions:["VIEW_TICKET"],listings:[{listingId:event,listingType:"Event"}]});
 const controller=require("../controllers/client/staffTicket.controller");
 const call=async()=>{const res=response();await controller.staffTicketCheckIn({params:{ticketId:String(issued._id)},user:{id:String(staff)}},res);return res;};
 assert.equal((await call()).code,403);await Invitation.updateOne({staff},{$set:{permissions:["SCAN_TICKET"]}});
 await cancel();assert.equal((await call()).code,409);assert.equal((await UserTicket.findById(issued._id)).status,"CANCELLED");
});
test("check-in racing with cancellation never leaves a usable unredeemed ticket",async()=>{
 const issued=await issueForLifecycle();const results=await Promise.allSettled([cancel(),require("../services/eventEntry.service").checkInEventTicket({eventId:event,ticketNumber:issued.ticketNumber,actor:owner})]);
 assert.equal(results[0].status,"fulfilled");assert.equal((await Event.findById(event)).status,"CANCELLED");assert.ok(["CANCELLED","REDEEMED"].includes((await UserTicket.findById(issued._id)).status));
});
test("transfer acceptance commits request, ownership, QR rotation and notice together",async()=>{
 const issued=await issueForLifecycle(),recipient=oid(),Request=require("../models/client/ticketTransferRequest.schema");
 const request=await Request.create({sender:buyer,recipient,ticketId:issued._id,ticketCategory:"USER_EVENT"});
 const res=response();await require("../controllers/client/ticketTransfer.controller").acceptTransfer({params:{requestId:String(request._id)},user:{id:String(recipient)}},res);
 assert.equal(res.code,200,JSON.stringify(res.body));const current=await UserTicket.findById(issued._id);assert.equal(String(current.owner),String(recipient));assert.notEqual(current.ticketNumber,issued.ticketNumber);assert.equal((await Request.findById(request._id)).status,"ACCEPTED");
 assert.equal(await Outbox.countDocuments({key:`ticket-transfer-accepted:${request._id}`}),1);
 assert.equal(await require("../services/eventEntry.service").checkInEventTicket({eventId:event,ticketNumber:issued.ticketNumber,actor:owner}),null);
});
test("failed transfer notification persistence rolls ownership and request state back",async()=>{
 const issued=await issueForLifecycle(),recipient=oid(),Request=require("../models/client/ticketTransferRequest.schema");
 const request=await Request.create({sender:buyer,recipient,ticketId:issued._id,ticketCategory:"USER_EVENT"});
 mock.method(Outbox,"bulkWrite",async()=>{throw Error("outbox unavailable")});
 const res=response();await require("../controllers/client/ticketTransfer.controller").acceptTransfer({params:{requestId:String(request._id)},user:{id:String(recipient)}},res);
 assert.equal(res.code,500);assert.equal(String((await UserTicket.findById(issued._id)).owner),String(buyer));assert.equal((await Request.findById(request._id)).status,"PENDING");
});
test("stale ticket quotes cannot reserve changed prices and past events cannot issue late usable tickets",async()=>{
 await Ticket.updateOne({_id:ticket},{$set:{price:{amountCents:10000}}});const quoted=await Ticket.findById(ticket);
 await Ticket.updateOne({_id:ticket},{$set:{price:{amountCents:20000}}});
 await assert.rejects(reserveEventBooking({...eventData(),quotedTicketVersions:[{ticketId:String(ticket),updatedAt:quoted.updatedAt}]}),/pricing changed/);
 assert.equal(await EventBooking.countDocuments(),0);
 const booking=await reserveEventBooking(eventData());await Event.updateOne({_id:event},{$set:{status:"COMPLETED"}});
 const result=await completePayment(booking.paymentReference,paid(booking.paymentReference,20000));assert.equal(result.conflict,true);assert.equal(result.booking.paymentResolutionRequired,true);assert.equal(await UserTicket.countDocuments(),0);
});
test("event media edits deny outsiders and never destroy unverified storage IDs",async()=>{
 const cloud=require("../utils/cloudinary");mock.method(cloud.uploader,"destroy",async()=>assert.fail("must not delete unverified public assets"));
 await Event.updateOne({_id:event},{$set:{status:"IN_PROGRESS",images:[{publicId:"example-asset",url:"https://example.test/image.jpg",position:0}]}});
 const controller=require("../controllers/client/event.controller");
 const call=async(user,publicId)=>{const res=response();await controller.deleteEventImage({params:{id:String(event)},user:{id:String(user)},body:{publicId}},res);return res;};
 assert.equal((await call(buyer,"example-asset")).code,403);assert.equal((await call(owner,"other-asset")).code,404);assert.equal((await call(owner,"example-asset")).code,200);
});

// Occurrence rollover and durable purchase regression coverage.
async function restartOccurrence(policy) {
  return mongoose.connection.transaction(async session => {
    const previous = await Event.findOneAndUpdate({ _id: event }, { $inc: { saleVersion: 1 } }, { new: true, session });
    const patch = { status: "LISTED", schedule: { from: new Date(Date.now() + 5 * 86400000), to: new Date(Date.now() + 6 * 86400000) } };
    await require("../services/eventOccurrence.service").changeSchedule(previous, patch, policy, session);
    return Event.findByIdAndUpdate(event, { $set: patch }, { new: true, session });
  });
}
test("completion expires unused tickets and cancels pending transfers atomically", async () => {
  const issued = await issueForLifecycle();
  const Request = require("../models/client/ticketTransferRequest.schema");
  await Request.create({ sender: buyer, recipient: oid(), ticketId: issued._id, ticketCategory: "USER_EVENT" });
  await Event.updateOne({ _id: event }, { $set: { "schedule.to": new Date(0) } });
  const result = await require("../services/eventOccurrence.service").completeOccurrence(event, { status: "LISTED" });
  assert.equal(result, true);
  assert.equal((await UserTicket.findById(issued._id)).status, "EXPIRED");
  assert.equal((await Request.findOne()).status, "CANCELLED");
});
test("new dates expire old unused tickets by default and old QR cannot enter", async () => {
  const issued = await issueForLifecycle();
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } });
  const current = await restartOccurrence();
  assert.equal(current.occurrence, 1);
  assert.equal((await UserTicket.findById(issued._id)).status, "EXPIRED");
  assert.equal(await require("../services/eventEntry.service").checkInEventTicket({ eventId: event, ticketNumber: issued.ticketNumber, actor: owner }), null);
});
test("explicit carry-over revives only unused tickets from the immediately previous occurrence", async () => {
  const issued = await issueForLifecycle();
  const other = await UserTicket.findOne({ _id: { $ne: issued._id } });
  await require("../services/eventEntry.service").checkInEventTicket({ eventId: event, ticketId: other._id, actor: owner });
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } });
  await restartOccurrence("HONOUR");
  const carried = await UserTicket.findById(issued._id);
  assert.equal(carried.status, "UNREDEEMED"); assert.equal(carried.occurrence, 1);
  assert.equal(carried.occurrenceHistory.length, 1); assert.ok(carried.validSchedule.from > carried.eventSnapshot.schedule.startDate);
  assert.equal(await require("../services/eventEntry.service").checkInEventTicket({ eventId: event, ticketNumber: other.ticketNumber, actor: owner }), null);
  assert.ok(await require("../services/eventEntry.service").checkInEventTicket({ eventId: event, ticketNumber: carried.ticketNumber, actor: owner }));
});
test("later opt-in cannot revive tickets left expired two occurrences ago", async () => {
  const issued = await issueForLifecycle();
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } }); await restartOccurrence("EXPIRE");
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } }); await restartOccurrence("HONOUR");
  assert.equal((await UserTicket.findById(issued._id)).status, "EXPIRED");
  assert.equal((await Event.findById(event)).occurrence, 2);
});
test("late payment for an old occurrence is queued for resolution and cannot issue new tickets", async () => {
  const booking = await reserveEventBooking(eventData());
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } }); await restartOccurrence("HONOUR");
  const result = await completePayment(booking.paymentReference, paid(booking.paymentReference, 20000));
  assert.equal(result.conflict, true); assert.equal(result.booking.paymentResolutionRequired, true);
  assert.equal(await UserTicket.countDocuments(), 0);
});
test("purchase outbox persists once across concurrent payment callbacks", async () => {
  const booking = await reserveEventBooking(eventData());
  await Promise.all([1, 2].map(() => completePayment(booking.paymentReference, paid(booking.paymentReference, 20000))));
  assert.equal(await Outbox.countDocuments({ key: "event-purchased:" + booking._id }), 1);
  const notice = await Outbox.findOne({ key: "event-purchased:" + booking._id });
  assert.equal(notice.receipt.totalAmount, 20000); assert.equal(notice.receipt.currency, "NGN");
});
test("purchase outbox failure rolls back payment and issuance", async () => {
  const booking = await reserveEventBooking(eventData());
  mock.method(Outbox, "bulkWrite", async () => { throw Error("purchase outbox unavailable"); });
  await assert.rejects(completePayment(booking.paymentReference, paid(booking.paymentReference, 20000)), /outbox unavailable/);
  assert.equal((await EventBooking.findById(booking._id)).paymentStatus, "PENDING");
  assert.equal(await UserTicket.countDocuments(), 0);
});
test("carry-over notice failure rolls back both ticket validity and occurrence", async () => {
  const issued = await issueForLifecycle();
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } });
  mock.method(Outbox, "bulkWrite", async () => { throw Error("carry outbox unavailable"); });
  await assert.rejects(restartOccurrence("HONOUR"), /outbox unavailable/);
  assert.equal((await Event.findById(event)).occurrence, 0);
  assert.equal((await UserTicket.findById(issued._id)).status, "UNREDEEMED");
});
test("crossing the sales deadline inside reservation rolls inventory back", async () => {
  await Ticket.updateOne({ _id: ticket }, { $set: { salesEndAt: new Date(0) } });
  await assert.rejects(reserveEventBooking(eventData()), /sales are closed/);
  assert.equal((await Ticket.findById(ticket)).soldQuantity, 0);
  assert.equal(await EventBooking.countDocuments(), 0);
});
test("finance exception refund requires ownership and is audited with a durable notice", async () => {
  const booking = await reserveEventBooking(eventData());
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } });
  await completePayment(booking.paymentReference, paid(booking.paymentReference, 20000));
  const controller = require("../controllers/management/paymentExceptions.controller"), admin = String(oid());
  const call = async (body, user = admin, roles = ["finance"]) => {
    const res = response(); await controller.update({ params: { id: String(booking._id) }, body, user: { id: user, roles } }, res); return res;
  };
  const settlement = { action: "RECORD_REFUND", settlementReference: "TEST-SETTLEMENT-001", notes: "Confirmed full refund in isolated test fixture.", confirmFullRefund: true };
  assert.equal((await call(settlement)).code, 409);
  assert.equal((await call({ action: "CLAIM" }, admin, ["support_admin"])).code, 403);
  assert.equal((await call({ action: "CLAIM" })).code, 200);
  assert.equal((await call({ action: "CLAIM" }, String(oid()))).code, 409);
  const result = await call(settlement); assert.equal(result.code, 200, JSON.stringify(result.body));
  assert.equal((await EventBooking.findById(booking._id)).paymentStatus, "REFUNDED");
  assert.equal(await Audit.countDocuments({ targetId: booking._id }), 2);
  assert.equal(await Outbox.countDocuments({ key: "payment-exception-refunded:" + booking._id }), 1);
  assert.equal((await call(settlement)).code, 409);
});

async function validEventFixture() {
  const Settings = require("../models/management/eventSettings.schema");
  await Settings.getSingleton();
  await User.updateOne({ _id: owner }, { $set: { isIdentityVerified: true } });
  await Event.updateOne({ _id: event }, { $set: {
    title: "Recurring Event", shortDescription: "A test event", description: "An isolated test event",
    schedule: { from: new Date(Date.now() + 2 * 86400000), to: new Date(Date.now() + 2 * 86400000 + 3600000) },
    eventType: "MUSIC_CONCERTS",
    images: [{ publicId: "test", url: "https://example.test/image.png", position: 0 }],
    location: { addressString: "Test address", street: "Test street", city: "Lagos", country: "Nigeria", coordinates: { latitude: 6.5, longitude: 3.4 } },
    cancellationRefundProcess: "Contact the organiser", cancellationRefundTimeline: "Within seven days",
    ticketGuide: { platformPolicyAcknowledged: true, refundPolicyType: "NO_REFUNDS", cancellationNotificationMethod: "Email",
      cancellationRefundProcess: "Contact the organiser", cancellationRefundTimeline: "Within seven days" },
  } });
}
test("event edit endpoint defaults to expiry and validates the next occurrence", async () => {
  await validEventFixture(); const issued = await issueForLifecycle();
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } });
  const controller = require("../controllers/client/event.controller");
  const res = response();
  await controller.updateEvent({ params: { id: String(event) }, user: { id: String(owner) },
    body: { schedule: { from: new Date(Date.now() + 7 * 86400000).toISOString(), to: new Date(Date.now() + 8 * 86400000).toISOString() } } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.occurrence, 1); assert.equal(res.body.data.status, "LISTED");
  assert.equal((await UserTicket.findById(issued._id)).status, "EXPIRED");
});
test("event edit endpoint honours unused tickets only after explicit opt-in", async () => {
  await validEventFixture(); const issued = await issueForLifecycle();
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } });
  const res = response();
  await require("../controllers/client/event.controller").updateEvent({ params: { id: String(event) }, user: { id: String(owner) },
    body: { previousTicketPolicy: "HONOUR", schedule: { from: new Date(Date.now() + 7 * 86400000).toISOString(), to: new Date(Date.now() + 8 * 86400000).toISOString() } } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal((await UserTicket.findById(issued._id)).occurrence, 1);
  assert.equal((await UserTicket.findById(issued._id)).status, "UNREDEEMED");
});
test("automatic publishing validates each pending event and keeps stale or incomplete events pending", async () => {
  await validEventFixture();
  await Event.updateOne({ _id: event }, { $set: { status: "ACTION_REQUIRED" } });
  const stale = oid(), incomplete = oid(), valid = (await Event.findById(event)).toObject();
  await Event.collection.insertMany([
    { ...valid, _id: stale, schedule: { from: new Date(0), to: new Date(1000) } },
    { ...valid, _id: incomplete, title: "" },
  ]);
  await require("../controllers/client/event.controller").syncUserEvents(owner, { throwOnError: true });
  assert.equal((await Event.findById(event)).status, "LISTED");
  assert.equal((await Event.findById(stale)).status, "ACTION_REQUIRED");
  assert.equal((await Event.findById(incomplete)).status, "ACTION_REQUIRED");
});
test("public event details exclude organiser and team email addresses", async () => {
  await Event.updateOne({ _id: event }, { $set: { staff: [buyer], coOrganisers: [buyer] } });
  const res = response();
  await require("../controllers/client/event.controller").getEventById({ params: { id: String(event) } }, res);
  assert.equal(res.code, 200);
  const payload = JSON.parse(JSON.stringify(res.body.data));
  assert.equal(payload.createdBy.email, undefined);
  assert.equal(payload.staff[0].email, undefined); assert.equal(payload.coOrganisers[0].email, undefined);
});
test("undo check-in cannot revive a redeemed ticket from a previous occurrence", async () => {
  const issued = await issueForLifecycle();
  await require("../services/eventEntry.service").checkInEventTicket({ eventId: event, ticketNumber: issued.ticketNumber, actor: owner });
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } }); await restartOccurrence("HONOUR");
  const res = response();
  await require("../controllers/client/userEventTicket.controller").uncheckInTicket({ user: { id: String(owner) }, body: { ticketNumber: issued.ticketNumber } }, res);
  assert.notEqual(res.code, 200); assert.equal((await UserTicket.findById(issued._id)).status, "REDEEMED");
});

test("legacy reused events cannot admit tickets whose original validity ended", async () => {
  const issued = await issueForLifecycle();
  await UserTicket.updateOne({ _id: issued._id }, {
    $unset: { occurrence: 1, validSchedule: 1 },
    $set: { "eventSnapshot.schedule.endDate": new Date(0) },
  });
  assert.equal(await require("../services/eventEntry.service").checkInEventTicket({ eventId: event, ticketNumber: issued.ticketNumber, actor: owner }), null);
  const legacy = await UserTicket.findById(issued._id);
  assert.throws(() => require("../services/eventOccurrence.service").assertTicketOccurrence(legacy, { occurrence: 0 }), /expired/);
});

test("cancellation preview and refunds exclude redeemed and previous-occurrence tickets", async () => {
  const issued = await issueForLifecycle();
  await require("../services/eventEntry.service").checkInEventTicket({ eventId: event, ticketNumber: issued.ticketNumber, actor: owner });
  const preview = response();
  await cancellationController.cancellationPreview({ params: { id: String(event) }, user: { id: String(owner) } }, preview);
  assert.equal(preview.code, 200); assert.equal(preview.body.data.refundLiabilityMinorByCurrency.NGN, 10000);
  await cancel();
  assert.equal(await Refund.countDocuments(), 1);
  assert.equal(await Refund.countDocuments({ ticketId: issued._id }), 0);
});
test("old expired occurrence is not refunded by cancellation of a newer occurrence", async () => {
  await issueForLifecycle();
  await Event.updateOne({ _id: event }, { $set: { status: "COMPLETED" } }); await restartOccurrence("EXPIRE");
  await cancel();
  assert.equal(await Refund.countDocuments(), 0);
  assert.equal(await UserTicket.countDocuments({ status: "EXPIRED" }), 2);
});
test("paid void review requires a settlement hold before approval", async () => {
  const issued = await issueForLifecycle(), service = require("../services/ticketVoidReview.service");
  const requested = await service.requestVoid(issued._id, owner);
  assert.equal(requested.reviewRequired, true);
  assert.equal((await UserTicket.findById(issued._id)).status, "UNREDEEMED");
  await service.requestVoid(issued._id, owner); assert.equal(await VoidReview.countDocuments(), 1);
  await assert.rejects(service.reviewVoid(requested.reviewId, oid(), { action: "APPROVE", notes: "Checked the request" }), /refund was settled/);
  await service.reviewVoid(requested.reviewId, oid(), { action: "PREPARE", notes: "Ready to settle refund" });
  await service.reviewVoid(requested.reviewId, oid(), { action: "APPROVE", notes: "Verified external test settlement", settlementReference: "REFUND-TEST-001", confirmRefundSettled: true });
  assert.equal((await UserTicket.findById(issued._id)).status, "CANCELLED");
  assert.equal(await Audit.countDocuments({ targetId: issued._id }), 2);
  await cancel(); assert.equal(await Refund.countDocuments({ ticketId: issued._id }), 0);
});
test("review approval fails after ticket use or ownership change", async () => {
  const issued = await issueForLifecycle(), service = require("../services/ticketVoidReview.service");
  const requested = await service.requestVoid(issued._id, owner);
  await require("../services/eventEntry.service").checkInEventTicket({ eventId: event, ticketNumber: issued.ticketNumber, actor: owner });
  await assert.rejects(service.reviewVoid(requested.reviewId, oid(), { action: "APPROVE", notes: "Verified test settlement", settlementReference: "REFUND-TEST-002", confirmRefundSettled: true }), /settlement hold|ownership or validity changed/);
  assert.equal((await VoidReview.findById(requested.reviewId)).status, "PENDING");
});
test("void audit failure rolls back ticket invalidation and decision", async () => {
  const issued = await issueForLifecycle(), service = require("../services/ticketVoidReview.service");
  const requested = await service.requestVoid(issued._id, owner);
  await service.reviewVoid(requested.reviewId, oid(), { action: "PREPARE", notes: "Ready to settle refund" });
  mock.method(Audit, "create", async () => { throw Error("audit unavailable"); });
  await assert.rejects(service.reviewVoid(requested.reviewId, oid(), { action: "APPROVE", notes: "Verified external test settlement", settlementReference: "REFUND-TEST-003", confirmRefundSettled: true }), /audit unavailable/);
  assert.equal((await UserTicket.findById(issued._id)).status, "UNREDEEMED");
  assert.equal((await VoidReview.findById(requested.reviewId)).status, "PENDING");
});
test("stale ticket mutations cannot commit after cancellation", async () => {
  const previous = await Event.findById(event);
  await cancel();
  await assert.rejects(mongoose.connection.transaction(session =>
    require("../services/ticketMutation.service").lockTicketEvent(previous, session)), /ended or changed/);
  const res = response();
  await require("../controllers/client/eventTicketType.controller").deleteTicket({ params: { id: String(ticket) }, user: { id: String(owner) } }, res);
  assert.equal(res.code, 409); assert.ok(await Ticket.findById(ticket));
});
test("concurrent tier creation respects the maximum number of tiers", async () => {
  await validEventFixture(); await Ticket.deleteMany({});
  await require("../models/management/eventSettings.schema").updateOne({ key: "event_settings" }, { $set: { "ticketing.maxTicketTiers": 1 } });
  const body = { eventId: String(event), name: "General", ticketType: "FREE", totalQuantity: 10,
    salesStartAt: new Date(), salesEndAt: new Date(Date.now() + 86400000),
    currency: { code: "NGN", symbol: "NGN" }, perTransactionLimit: { min: 1, max: 5 } };
  const run = async () => { const res = response(); await require("../controllers/client/eventTicketType.controller").createTicket({ user: { id: String(owner) }, body }, res); return res; };
  const results = await Promise.all([run(), run()]);
  assert.equal(results.filter(res => res.code === 201).length, 1, JSON.stringify(results.map(r => r.body)));
  assert.equal(await Ticket.countDocuments(), 1);
});
test("event media cannot be attached by another account or with a forged URL", async () => {
  const asset = await Media.create({ publicId: "event-media/owned", owner, state: "READY", url: "https://example.test/owned.png", cleanupAfter: new Date() });
  const service = require("../services/eventMedia.service");
  const attach = (actor, url = asset.url) => mongoose.connection.transaction(session => service.attachMedia({ images: [{ publicId: asset.publicId, url }] }, {}, event, actor, session));
  await assert.rejects(attach(buyer), /does not belong/);
  await assert.rejects(attach(owner, "https://example.test/forged.png"), /does not belong/);
  await attach(owner); assert.equal((await Media.findById(asset._id)).state, "ATTACHED");
});
test("event media cleanup retains ticket snapshots and deletes only registered orphans", async () => {
  const issued = await issueForLifecycle(), destroyed = [];
  const cloud = require("../utils/cloudinary"); mock.method(cloud.uploader, "destroy", async id => { destroyed.push(id); return { result: "ok" }; });
  await Media.create([
    { publicId: "event-media/orphan", owner, state: "READY", url: "https://example.test/orphan.png", cleanupAfter: new Date(0) },
    { publicId: "event-media/receipt-image", owner, state: "ATTACHED", url: "https://example.test/receipt.png", cleanupAfter: new Date(0) },
  ]);
  await UserTicket.updateOne({ _id: issued._id }, { $set: { "eventSnapshot.coverImage": "https://example.test/receipt.png" } });
  const result = await require("../services/eventMedia.service").cleanupEventMedia();
  assert.equal(result.deleted, 1); assert.deepEqual(destroyed, ["event-media/orphan"]);
  assert.equal((await Media.findOne({ publicId: "event-media/receipt-image" })).state, "ATTACHED");
});
test("cleanup claims prevent later attachment", async () => {
  await Media.create({ publicId: "event-media/cleaning", owner, state: "CLEANING", url: "https://example.test/cleaning.png" });
  await assert.rejects(mongoose.connection.transaction(session => require("../services/eventMedia.service").attachMedia(
    { images: [{ publicId: "event-media/cleaning", url: "https://example.test/cleaning.png" }] }, {}, event, owner, session)), /does not belong/);
});
test("worker claims prevent concurrent execution and failures release the lease", async () => {
  const { runWorker } = require("../services/eventOperations.service");
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const first = runWorker("test-worker", async () => { started(); await gate; return { processed: 1 }; });
  await began;
  assert.equal((await runWorker("test-worker", () => assert.fail("must not run twice"))).skipped, true);
  release(); await first;
  await assert.rejects(runWorker("test-worker", async () => { throw Error("test failure"); }), /test failure/);
  const health = await Health.findOne({ name: "test-worker" });
  assert.equal(health.lastError, "test failure"); assert.equal(health.lockedUntil.getTime(), 0);
});
test("operations report unresolved payments and missing worker heartbeats", async () => {
  await EventBooking.collection.insertOne({ eventId: event, buyer, paymentResolutionRequired: true });
  const result = await require("../services/eventOperations.service").getEventOperations();
  assert.equal(result.paymentExceptions, 1);
  assert.ok(result.alerts.some(message => message.includes("heartbeat")));
  assert.ok(result.alerts.some(message => message.includes("finance review")));
});


test("media completion verifies provider metadata and is idempotent", async () => {
  const publicId = "event-media/verified-upload", url = "https://example.test/verified.png";
  await Media.create({ publicId, owner, expiresAt: new Date(Date.now() + 60000) });
  const cloud = require("../utils/cloudinary"); let calls = 0;
  mock.method(cloud.api, "resource", async () => { calls++; return { public_id: publicId, resource_type: "image", type: "upload", format: "png", bytes: 1000, secure_url: url }; });
  const complete = require("../controllers/client/eventMedia.controller").complete;
  for (let i = 0; i < 2; i++) {
    const res = response(); await complete({ user: { id: String(owner) }, body: { publicId } }, res);
    assert.equal(res.body.data.secure_url, url);
  }
  assert.equal(calls, 1); assert.equal((await Media.findOne({ publicId })).state, "READY");
});

test("media completion rejects other owners and oversized provider assets", async () => {
  const publicId = "event-media/rejected-upload";
  await Media.create({ publicId, owner, expiresAt: new Date(Date.now() + 60000) });
  const cloud = require("../utils/cloudinary"); let calls = 0;
  mock.method(cloud.api, "resource", async () => { calls++; return { public_id: publicId, resource_type: "image", type: "upload", format: "png", bytes: 9 * 1024 * 1024, secure_url: "https://example.test/large.png" }; });
  const complete = require("../controllers/client/eventMedia.controller").complete;
  const forbidden = response(); await complete({ user: { id: String(buyer) }, body: { publicId } }, forbidden);
  assert.equal(forbidden.code, 409); assert.equal(calls, 0);
  const oversized = response(); await complete({ user: { id: String(owner) }, body: { publicId } }, oversized);
  assert.equal(oversized.code, 422); assert.equal((await Media.findOne({ publicId })).state, "PENDING");
});

test("payment replay after cancellation never adds refunds for redeemed or staff-voided tickets", async () => {
  const issued = await issueForLifecycle();
  await UserTicket.updateOne({ _id: issued._id }, { $set: { status: "REDEEMED" } });
  const booking = await EventBooking.findById(issued.bookingId);
  await cancel(); assert.equal(await Refund.countDocuments(), 1);
  await completePayment(booking.paymentReference, paid(booking.paymentReference, 20000));
  await completePayment(booking.paymentReference, paid(booking.paymentReference, 20000));
  assert.equal(await Refund.countDocuments(), 1); assert.equal(await Refund.countDocuments({ ticketId: issued._id }), 0);
});
test("paid listing cannot return to draft through the general edit endpoint", async () => {
  await issueForLifecycle(); const res = response();
  await require("../controllers/client/event.controller").updateEvent({ params: { id: String(event) }, user: { id: String(owner) }, body: { status: "IN_PROGRESS" } }, res);
  assert.equal(res.code, 409); assert.equal((await Event.findById(event)).status, "LISTED");
});
test("transferred ticket details never expose the original buyer contact or order", async () => {
  const booking = await reserveEventBooking({ ...eventData(), guestDetails: { fullName: "Private Buyer", email: "private@example.test", phoneNumber: "12345678" } });
  await completePayment(booking.paymentReference, paid(booking.paymentReference, 20000));
  const issued = await UserTicket.findOne(), recipient = oid();
  await UserTicket.updateOne({ _id: issued._id }, { $set: { owner: recipient } });
  const res = response(); await require("../controllers/client/userEventTicket.controller").getTicketDetails({ params: { id: String(issued._id) }, user: { id: String(recipient) } }, res);
  assert.equal(res.code, 200); assert.equal(String(res.body.data.bookingId), String(booking._id));
  assert.ok(!JSON.stringify(res.body).includes("private@example.test")); assert.ok(!JSON.stringify(res.body).includes("12345678"));
});
test("published event cannot remove its required cover", async () => {
  await require("../models/management/eventSettings.schema").updateOne({ key: "event_settings" }, { $set: { "publishing.requireCoverImage": true } }, { upsert: true });
  await Event.updateOne({ _id: event }, { $set: { images: [{ publicId: "legacy-photo", url: "https://example.test/photo.png", position: 0 }] } });
  const res = response(); await require("../controllers/client/event.controller").deleteEventImage({ params: { id: String(event) }, user: { id: String(owner) }, body: { publicId: "legacy-photo" } }, res);
  assert.equal(res.code, 409); assert.equal((await Event.findById(event)).images.length, 1);
});
test("settlement hold blocks admission, pending transfer acceptance and rescheduling", async () => {
  await validEventFixture(); const issued = await issueForLifecycle(), recipient = oid();
  const Request = require("../models/client/ticketTransferRequest.schema");
  const transfer = await Request.create({ ticketId: issued._id, ticketCategory: "USER_EVENT", sender: buyer, recipient });
  const service = require("../services/ticketVoidReview.service"), review = await service.requestVoid(issued._id, owner);
  await service.reviewVoid(review.reviewId, oid(), { action: "PREPARE", notes: "Ready to settle refund" });
  assert.equal(await require("../services/eventEntry.service").checkInEventTicket({ eventId: event, ticketNumber: issued.ticketNumber, actor: owner }), null);
  assert.equal((await Request.findById(transfer._id)).status, "CANCELLED");
  const responseTransfer = response();
  await require("../controllers/client/ticketTransfer.controller").acceptTransfer({ params: { requestId: String(transfer._id) }, user: { id: String(recipient) } }, responseTransfer);
  assert.equal(responseTransfer.code, 409);
  const res = response(); await require("../controllers/client/event.controller").updateEvent({ params: { id: String(event) }, user: { id: String(owner) },
    body: { schedule: { from: new Date(Date.now() + 3 * 86400000), to: new Date(Date.now() + 4 * 86400000) } } }, res);
  assert.equal(res.code, 409);
});
test("settled hold can be finalized after event cancellation without duplicate obligation", async () => {
  const issued = await issueForLifecycle(), service = require("../services/ticketVoidReview.service");
  const review = await service.requestVoid(issued._id, owner);
  await service.reviewVoid(review.reviewId, oid(), { action: "PREPARE", notes: "Ready to settle refund" });
  await cancel(); assert.equal(await Refund.countDocuments({ ticketId: issued._id }), 0);
  await service.reviewVoid(review.reviewId, oid(), { action: "APPROVE", notes: "Verified bank settlement", settlementReference: "BANK-TEST-123", confirmRefundSettled: true });
  assert.equal((await UserTicket.findById(issued._id)).status, "CANCELLED");
  const booking = await EventBooking.findById(issued.bookingId);
  await completePayment(booking.paymentReference, paid(booking.paymentReference, 20000));
  assert.equal(await Refund.countDocuments({ ticketId: issued._id }), 0);
});
test("rejecting unpaid hold after cancellation transfers obligation to cancellation refunds", async () => {
  const issued = await issueForLifecycle(), service = require("../services/ticketVoidReview.service");
  const review = await service.requestVoid(issued._id, owner);
  await service.reviewVoid(review.reviewId, oid(), { action: "PREPARE", notes: "Ready to settle refund" });
  await cancel();
  await assert.rejects(service.reviewVoid(review.reviewId, oid(), { action: "REJECT", notes: "No settlement was sent" }), /Confirm no refund/);
  await service.reviewVoid(review.reviewId, oid(), { action: "REJECT", notes: "No settlement was sent", confirmNoSettlement: true });
  assert.equal(await Refund.countDocuments({ ticketId: issued._id }), 1);
  assert.equal((await UserTicket.findById(issued._id)).refundHold, false);
});
test("completion preserves settlement hold and allows later settlement recording", async () => {
  const issued = await issueForLifecycle(), service = require("../services/ticketVoidReview.service");
  const review = await service.requestVoid(issued._id, owner);
  await service.reviewVoid(review.reviewId, oid(), { action: "PREPARE", notes: "Ready to settle refund" });
  await require("../services/eventOccurrence.service").completeOccurrence(event, { status: "LISTED" });
  assert.equal((await UserTicket.findById(issued._id)).status, "UNREDEEMED");
  await service.reviewVoid(review.reviewId, oid(), { action: "APPROVE", notes: "Verified bank settlement", settlementReference: "BANK-TEST-456", confirmRefundSettled: true });
  assert.equal((await UserTicket.findById(issued._id)).status, "CANCELLED");
});
test("rejected void review reopens with preserved history", async () => {
  const issued = await issueForLifecycle(), service = require("../services/ticketVoidReview.service");
  const review = await service.requestVoid(issued._id, owner);
  await service.reviewVoid(review.reviewId, oid(), { action: "REJECT", notes: "Original request declined" });
  await service.requestVoid(issued._id, owner);
  const reopened = await VoidReview.findById(review.reviewId);
  assert.equal(reopened.status, "PENDING"); assert.ok(reopened.history.some(row => row.status === "REJECTED"));
});
test("checkout retries and concurrent reservations share one buyer-scoped attempt", async () => {
  const attempt = { checkoutKey: "test-checkout-attempt-001", checkoutFingerprint: "same-cart" };
  const bookings = await Promise.all([1,2].map(() => reserveEventBooking({ ...eventData(), ...attempt })));
  assert.equal(String(bookings[0]._id), String(bookings[1]._id));
  assert.equal(await EventBooking.countDocuments(), 1); assert.equal((await Ticket.findById(ticket)).soldQuantity, 2);
  await assert.rejects(reserveEventBooking({ ...eventData(), ...attempt, checkoutFingerprint: "changed-cart" }), /does not match/);
});
test("checkout controller recovers free and paid attempts without extra tickets or provider initialization", async () => {
  await User.updateOne({ _id: owner }, { $set: { vendorAccountCode: "TEST-SUBACCOUNT" } });
  let initializations = 0;
  mock.method(require("../services/payment"), "getPaymentGateway", () => ({ initializePayment: async ({ reference }) => {
    initializations++; return { reference, access_code: "test-access", authorization_url: "https://example.test/pay" };
  } }));
  const controller = require("../controllers/client/eventBooking.controller");
  const body = { eventId: String(event), paymentMethod: "CARD", idempotencyKey: "test-checkout-controller-001", items: [{ product: String(ticket), quantity: 1, pricePerUnit: 10000 }] };
  const first = response(); await controller.createBooking({ user: { id: String(buyer) }, body }, first);
  assert.equal(first.code, 200, JSON.stringify(first.body));
  const second = response(); await controller.createBooking({ user: { id: String(buyer) }, body }, second);
  assert.equal(second.code, 200); assert.equal(String(first.body.data.booking._id), String(second.body.data.booking._id));
  assert.equal(initializations, 1); assert.equal(await EventBooking.countDocuments(), 1);
  assert.equal(second.body.data.payment.access_code, "test-access");
  assert.equal(second.body.data.booking.checkoutSubaccount, undefined);
  await Ticket.updateOne({ _id: ticket }, { $set: { ticketType: "FREE" } });
  const freeBody = { ...body, paymentMethod: "FREE", idempotencyKey: "test-checkout-free-001" };
  const free = response(); await controller.createBooking({ user: { id: String(buyer) }, body: freeBody }, free);
  assert.equal(free.code, 200, JSON.stringify(free.body));
  const retry = response(); await controller.createBooking({ user: { id: String(buyer) }, body: freeBody }, retry);
  assert.equal(retry.code, 200); assert.equal(await UserTicket.countDocuments(), 1);
});
test("stuck worker alerts even with a current heartbeat", async () => {
  await Health.create({ name: "payment-reconciliation", startedAt: new Date(Date.now() - 3600000), heartbeatAt: new Date(),
    completedAt: new Date(Date.now() - 7200000), lockedUntil: new Date(Date.now() + 60000) });
  const result = await require("../services/eventOperations.service").getEventOperations();
  assert.ok(result.alerts.some(text => text.includes("expected run duration")));
  assert.ok(result.alerts.some(text => text.includes("recent successful completion")));
});
test("external alert delivery uses configured endpoint and suppresses repeated alerts", async () => {
  const before = process.env.EVENT_ALERT_WEBHOOK_URL;
  process.env.EVENT_ALERT_WEBHOOK_URL = "https://alerts.example.test/event";
  let sent = 0; mock.method(require("axios"), "post", async () => { sent++; return { status: 200 }; });
  try {
    await require("../services/eventAlertDelivery.service").deliverEventAlerts();
    await require("../services/eventAlertDelivery.service").deliverEventAlerts();
    assert.equal(sent, 1);
  } finally {
    if (before === undefined) delete process.env.EVENT_ALERT_WEBHOOK_URL; else process.env.EVENT_ALERT_WEBHOOK_URL = before;
  }
});
test("PDF uses current valid dates and marks cancelled tickets without entry QR", async () => {
  const issued = await issueForLifecycle();
  await UserTicket.updateOne({ _id: issued._id }, { $set: { validSchedule: { from: new Date("2031-05-10T12:00:00Z"), to: new Date("2031-05-11T12:00:00Z") }, status: "CANCELLED" } });
  const PDF = require("pdfkit"), original = PDF.prototype.text, texts = [];
  mock.method(PDF.prototype, "text", function(text, ...args) { texts.push(String(text)); return original.call(this, text, ...args); });
  const res = { ...response(), setHeader() {}, send(buffer) { this.buffer = buffer; } };
  await require("../controllers/client/ticketExport.controller").generateTicketPDF({ user: { id: String(buyer) }, params: { ticketId: String(issued._id) }, query: { ticketCategory: "USER_EVENT" } }, res);
  assert.equal(res.code, 200); assert.ok(res.buffer?.length);
  assert.ok(texts.some(text => text.includes("2031"))); assert.ok(texts.includes("NOT VALID FOR ENTRY - CANCELLED"));
  assert.ok(!texts.includes("SCAN FOR ENTRY"));
});

test("uncertain checkout initialization retries the same reference and recovers paid status", async () => {
  const attempt = require("../services/eventCheckoutAttempt.service");
  const saved = await reserveEventBooking({ ...eventData(), guestDetails: { email: "buyer@example.test" }, checkoutKey: "uncertain-checkout-001", checkoutFingerprint: "cart" });
  const references = [];
  mock.method(require("../services/payment"), "getPaymentGateway", () => ({
    initializePayment: async ({ reference }) => { references.push(reference); throw Error("lost response"); },
    verifyPayment: async reference => paid(reference, 20000),
  }));
  const res = response(); await attempt.respond(saved._id, res);
  assert.equal(res.code, 200); assert.equal(res.body.data.booking.paymentStatus, "COMPLETED");
  assert.deepEqual(references, [saved.paymentReference]); assert.equal(await EventBooking.countDocuments(), 1);
  assert.equal(await UserTicket.countDocuments(), 2);
});
test("unresolved initialization retains the attempt and does not reserve again", async () => {
  const attempt = require("../services/eventCheckoutAttempt.service");
  const saved = await reserveEventBooking({ ...eventData(), guestDetails: { email: "buyer@example.test" }, checkoutKey: "uncertain-checkout-002", checkoutFingerprint: "cart" });
  const references = [];
  mock.method(require("../services/payment"), "getPaymentGateway", () => ({
    initializePayment: async ({ reference }) => { references.push(reference); throw Error("provider unavailable"); },
    verifyPayment: async () => { throw Error("provider unavailable"); },
  }));
  await assert.rejects(attempt.respond(saved._id, response()), /could not be confirmed/);
  await assert.rejects(attempt.respond(saved._id, response()), /could not be confirmed/);
  assert.deepEqual(references, [saved.paymentReference, saved.paymentReference]);
  assert.equal(await EventBooking.countDocuments(), 1); assert.equal((await Ticket.findById(ticket)).soldQuantity, 2);
});

for (const listingStatus of ["IN_PROGRESS", "LISTED"]) {
  test("photo additions preserve existing image fields on " + listingStatus + " events", async () => {
    await validEventFixture();
    await Event.updateOne({ _id: event }, { $set: { status: listingStatus, images: [
      { publicId: "legacy-cover", url: "https://example.test/legacy.jpg", position: 0 },
    ] } });
    const controller = require("../controllers/client/event.controller");
    for (let i = 1; i <= 2; i++) {
      const asset = await Media.create({ publicId: "event-media/new-photo-" + i, url: "https://example.test/new-" + i + ".jpg", owner, state: "READY" });
      const res = response();
      await controller.updateEvent({ params: { id: String(event) }, user: { id: String(owner) }, body: {
        images: [{ publicId: asset.publicId, url: asset.url }],
      } }, res);
      assert.equal(res.code, 200, JSON.stringify(res.body));
      const current = await Event.findById(event).lean();
      assert.equal(current.images.length, i + 1);
      assert.equal(current.images[0].publicId, "legacy-cover");
      assert.equal(current.images[0].url, "https://example.test/legacy.jpg");
      assert.deepEqual(current.images.map(image => image.position), Array.from({ length: i + 1 }, (_, index) => index));
      assert.equal((await Media.findById(asset._id)).state, "ATTACHED");
    }
  });
}

test("free ticket recovery reads local completion and never calls payment provider", async () => {
  const input = eventData("free-recovery-test");
  input.items = input.items.map(item => ({ ...item, pricePerUnit: 0, totalPrice: 0 }));
  const booking = await reserveEventBooking({ ...input, subtotalAmount: 0, totalAmount: 0, paymentMethod: "FREE", paymentStatus: "COMPLETED" });
  mock.method(require("../services/payment/adapters/paystack.adapter").prototype, "verifyPayment", async () => assert.fail("Free tickets must never reach payment provider"));
  const controller = require("../controllers/client/eventBooking.controller");
  const req = { params: { reference: booking.paymentReference }, user: { id: String(buyer) } };
  const status = response(); await controller.getBookingPaymentStatus(req, status);
  assert.equal(status.body.data.booking.totalAmount, 0); assert.equal(status.body.data.booking.paymentStatus, "COMPLETED");
  const res = response(); await controller.verifyBooking(req, res);
  assert.equal(res.code, 200); assert.equal(res.body.data.tickets.length, 2);
});
test("payment status and verification reject another buyer before provider access", async () => {
  const booking = await reserveEventBooking(eventData("private-recovery-test"));
  mock.method(require("../services/payment/adapters/paystack.adapter").prototype, "verifyPayment", async () => assert.fail("Unauthorised caller must not reach provider"));
  const controller = require("../controllers/client/eventBooking.controller");
  for (const method of ["getBookingPaymentStatus", "verifyBooking"]) {
    const res = response(); await controller[method]({ params: { reference: booking.paymentReference }, user: { id: String(owner) } }, res);
    assert.equal(res.code, 404);
  }
});


const settlementCall = async (refund, user = owner, body = { bankDetailsVersion: refund.bankDetailsVersion || 0 }) => {
 const res=response();await require("../controllers/client/refundSettlement.controller").prepare({params:{refundId:String(refund._id)},user:{id:String(user)},body},res);return res;
};
const bankChange = async refund => {
 const res=response();await refundController.submitBankDetails({params:{refundId:String(refund._id)},user:{id:String(buyer)},body:{accountName:"New destination",accountNumber:"9876543210",bankCode:"058"}},res);return res;
};
test("settlement preparation freezes the displayed bank version and is idempotent",async()=>{
 const refund=await newRefund({settlement:undefined});
 assert.equal((await settlementCall(refund,buyer)).code,409);
 const first=await settlementCall(refund);assert.equal(first.code,200);
 assert.equal(first.body.data.bankDetails.accountNumber,"0123456789");
 assert.ok(first.body.data.settlement.id);assert.equal(first.body.data.settlement.bankDetailsVersion,0);
 const replay=await settlementCall(refund);assert.equal(replay.body.data.settlement.id,first.body.data.settlement.id);
 assert.equal(await Outbox.countDocuments(),1);
 assert.equal((await bankChange(refund)).code,409);
 assert.equal((await Refund.findById(refund._id).select("+bankDetails.accountNumber")).bankDetails.accountNumber,"0123456789");
});
test("stale bank views and concurrent bank edits cannot prepare the wrong destination",async()=>{
 const refund=await newRefund({settlement:undefined});
 assert.equal((await bankChange(refund)).code,200);
 assert.equal((await settlementCall(refund)).code,409);
 const current=await Refund.findById(refund._id);
 const results=await Promise.all([settlementCall(current),bankChange(current)]);
 if(results[0].code===200) assert.equal(results[1].code,409);
 else {assert.equal(results[0].code,409);assert.equal(results[1].code,200);}
});
test("settlement preparation rolls back its lock when the holder notice fails",async()=>{
 const refund=await newRefund({settlement:undefined});
 const failedNotice=mock.method(Outbox,"bulkWrite",async()=>{throw Error("notice failed")});
 assert.equal((await settlementCall(refund)).code,500);
 assert.equal((await Refund.findById(refund._id)).settlement?.id,undefined);
 failedNotice.mock.restore();
 assert.equal((await bankChange(refund)).code,200);
});
test("proof and mark-paid must belong to the active settlement and bank version",async()=>{
 const refund=await newRefund({settlement:undefined});
 const prepared=await settlementCall(refund),id=prepared.body.data.settlement.id;
 const cloud=require("../utils/cloudinary"),controller=require("../controllers/client/eventRefundReceipt.controller");
 let uploads=0;
 mock.method(cloud,"config",()=>({cloud_name:"test",api_key:"test",api_secret:"test"}));
 mock.method(cloud.utils,"api_sign_request",()=>"signature");
 mock.method(cloud.api,"resource",async()=>{uploads++;return {type:"authenticated",resource_type:"image",format:"png",bytes:100};});
 const call=async(method,body)=>{const res=response();await controller[method]({params:{refundId:String(refund._id)},user:{id:String(owner)},body},res);return res;};
 assert.equal((await call("prepareReceiptUpload",{})).code,409);
 const ready=await call("prepareReceiptUpload",{settlementId:id});assert.equal(ready.code,200);
 const publicId=ready.body.data.parameters.public_id;
 assert.equal((await call("completeReceiptUpload",{publicId,settlementId:"stale"})).code,409);
 assert.equal(uploads,0);
 assert.equal((await call("completeReceiptUpload",{publicId,settlementId:id})).code,200);
 assert.equal((await Refund.findById(refund._id)).receipt.settlementId,id);
 assert.equal((await Attempts.findOne({publicId})).settlementId,id);
 const mark=async settlementId=>{const res=response();await refundController.markRefundPaid({params:{refundId:String(refund._id)},user:{id:String(owner)},body:{settlementId}},res);return res;};
 assert.equal((await mark("stale")).code,409);
 await Refund.updateOne({_id:refund._id},{$set:{"receipt.settlementId":"stale"}});
 assert.equal((await mark(id)).code,409);
 await Refund.updateOne({_id:refund._id},{$set:{"receipt.settlementId":id},$inc:{bankDetailsVersion:1}});
 assert.equal((await mark(id)).code,409);
 await Refund.updateOne({_id:refund._id},{$inc:{bankDetailsVersion:-1}});
 assert.equal((await mark(id)).code,200);
 assert.equal((await Refund.findById(refund._id)).paidSettlementId,id);
});
test("support recovery archives settlement and invalidates old receipt sessions",async()=>{
 const refund=await newRefund({settlement:undefined});
 const prepared=await settlementCall(refund),oldId=prepared.body.data.settlement.id;
 await Refund.updateOne({_id:refund._id},{$set:{supportRequest:{status:"OPEN",reason:"Wrong account"}}});
 const controller=require("../controllers/client/refundSupport.controller"),res=response();
 await controller.recoverUnpaidRefund({params:{id:String(refund._id)},user:{id:String(oid())},body:{reason:"Verified no money was sent",confirmNoPayment:true}},res);
 assert.equal(res.code,200);
 const reopened=await Refund.findById(refund._id).select("+recoveryHistory");
 assert.equal(reopened.settlement?.id,undefined);assert.equal(reopened.recoveryHistory[0].settlement.id,oldId);
 assert.equal((await bankChange(refund)).code,200);
 const current=await Refund.findById(refund._id),next=await settlementCall(current);
 assert.equal(next.code,200);assert.notEqual(next.body.data.settlement.id,oldId);
 const stale=response();await require("../controllers/client/eventRefundReceipt.controller").uploadReceipt({params:{refundId:String(refund._id)},user:{id:String(owner)},headers:{"x-refund-settlement-id":oldId},body:"unused"},stale);
 assert.equal(stale.code,404);
});
test("legacy proof needs support review and already-paid legacy refunds stay confirmable",async()=>{
 const refund=await newRefund({settlement:undefined,receipt:{publicId:"legacy",format:"png",uploadedAt:new Date()}});
 assert.equal((await settlementCall(refund)).code,409);
 const mark=response();await refundController.markRefundPaid({params:{refundId:String(refund._id)},user:{id:String(owner)},body:{}},mark);assert.equal(mark.code,409);
 await Refund.updateOne({_id:refund._id},{$set:{status:"MARKED_PAID",markedPaidAt:new Date()}});
 const confirmed=response();await refundController.confirmRefund({params:{refundId:String(refund._id)},user:{id:String(buyer)}},confirmed);assert.equal(confirmed.code,200);
});

test("settlement preparation validates requests and refuses an open account-correction request",async()=>{
 const refund=await newRefund({settlement:undefined});
 for(const version of [undefined,-1,0.5,"0"])assert.equal((await settlementCall(refund,owner,{bankDetailsVersion:version})).code,400);
 await Refund.updateOne({_id:refund._id},{$set:{"supportRequest.status":"OPEN"}});
 assert.equal((await settlementCall(refund)).code,409);
});
test("pre-version bank details can be locked without a database migration",async()=>{
 const refund=await newRefund({settlement:undefined});
 await Refund.collection.updateOne({_id:refund._id},{$unset:{bankDetailsVersion:1}});
 const result=await settlementCall(refund);assert.equal(result.code,200);
 assert.equal(result.body.data.bankDetailsVersion,0);assert.equal(result.body.data.settlement.bankDetailsVersion,0);
});

test("concurrent organisers' preparation retries retain exactly one settlement",async()=>{
 const refund=await newRefund({settlement:undefined});
 const results=await Promise.all([settlementCall(refund),settlementCall(refund)]);
 assert.deepEqual(results.map(result=>result.code),[200,200]);
 assert.equal(results[0].body.data.settlement.id,results[1].body.data.settlement.id);
 assert.equal(await Outbox.countDocuments(),1);
});


async function transferForPrivacy(ticketDoc, sender = buyer, recipient = oid()) {
 await User.collection.updateOne({_id:recipient},{$setOnInsert:{firstName:"New",surname:"Holder",email:String(recipient)+"@example.test"}},{upsert:true});
 const request=await require("../models/client/ticketTransferRequest.schema").create({sender,recipient,ticketId:ticketDoc._id,ticketCategory:"USER_EVENT"});
 const res=response();await require("../controllers/client/ticketTransfer.controller").acceptTransfer({params:{requestId:String(request._id)},user:{id:String(recipient)}},res);
 assert.equal(res.code,200,JSON.stringify(res.body));
 return {request,recipient,current:await UserTicket.findById(ticketDoc._id)};
}
test("payment verification and checkout replay never reveal transferred ticket credentials",async()=>{
 const issued=await issueForLifecycle(),{current,recipient}=await transferForPrivacy(issued);
 const booking=await EventBooking.findById(issued.bookingId),verified=response();
 await require("../controllers/client/eventBooking.controller").verifyBooking({params:{reference:booking.paymentReference},user:{id:String(buyer)}},verified);
 assert.equal(verified.code,200);assert.equal(verified.body.data.tickets.length,1);
 assert.ok(verified.body.data.tickets.every(ticket=>String(ticket.owner)===String(buyer)));
 const replay=response();await require("../services/eventCheckoutAttempt.service").respond(booking._id,replay);
 assert.equal(replay.body.data.tickets.length,1);assert.ok(replay.body.data.tickets.every(row=>String(row.owner)===String(buyer)));
 const owned=response();await require("../controllers/client/userEventTicket.controller").getTicketDetails({params:{id:String(issued._id)},user:{id:String(recipient)}},owned);
 assert.equal(owned.code,200);assert.equal(owned.body.data.qrPayload,current.qrPayload);
 assert.equal(await require("../services/eventEntry.service").checkInEventTicket({eventId:event,ticketNumber:issued.ticketNumber,actor:owner}),null);
 assert.ok(await require("../services/eventEntry.service").checkInEventTicket({eventId:event,ticketNumber:current.ticketNumber,actor:owner}));
});
test("checkout replay with every ticket gifted returns no entry credentials",async()=>{
 const issued=await issueForLifecycle();for(const row of await UserTicket.find())await transferForPrivacy(row);
 const res=response();await require("../services/eventCheckoutAttempt.service").respond(issued.bookingId,res);assert.equal(res.body.data.tickets.length,0);
});
test("all earlier transfer participants lose access to the current entry number",async()=>{
 const issued=await issueForLifecycle(),first=await transferForPrivacy(issued),second=await transferForPrivacy(first.current,first.recipient);
 const controller=require("../controllers/client/ticketTransfer.controller");
 for(const user of [buyer,first.recipient]){
  const history=response();await controller.getTransferHistory({params:{ticketId:String(issued._id)},query:{ticketCategory:"USER_EVENT"},user:{id:String(user)}},history);
  assert.equal(history.code,200);assert.equal(history.body.data.currentTicketNumber,undefined);assert.ok(!JSON.stringify(history.body).includes(second.current.ticketNumber));
  const details=response();await controller.getTransferRequestDetails({params:{requestId:String(first.request._id)},user:{id:String(user)}},details);
  assert.equal(details.code,200);assert.equal(details.body.data.ticketDetails.ticketNumber,undefined);
 }
 const history=response();await controller.getTransferHistory({params:{ticketId:String(issued._id)},query:{ticketCategory:"USER_EVENT"},user:{id:String(second.recipient)}},history);
 assert.equal(history.body.data.currentTicketNumber,second.current.ticketNumber);
});
test("pending transfers survive rescheduling past the old start and use current dates",async()=>{
 await validEventFixture();await Event.updateOne({_id:event},{$set:{schedule:{from:new Date(Date.now()-3600000),to:new Date(Date.now()+86400000)}}});
 const issued=await issueForLifecycle(),from=new Date(Date.now()+7*86400000),to=new Date(Date.now()+8*86400000),updated=response();
 await require("../controllers/client/event.controller").updateEvent({params:{id:String(event)},user:{id:String(owner)},body:{schedule:{from:from.toISOString(),to:to.toISOString()}}},updated);assert.equal(updated.code,200);
 const recipient=oid();await User.collection.insertOne({_id:recipient,firstName:"Recipient",surname:"Test",email:"recipient@example.test"});
 const controller=require("../controllers/client/ticketTransfer.controller"),sent=response();
 await controller.initiateTransfer({user:{id:String(buyer)},body:{ticketId:String(issued._id),ticketCategory:"USER_EVENT",recipientEmail:"recipient@example.test"}},sent);assert.equal(sent.code,201);
 const pending=response();await controller.getPendingTransfers({user:{id:String(recipient)}},pending);assert.equal(pending.body.data.length,1);assert.equal(new Date(pending.body.data[0].schedule.startDate).getTime(),from.getTime());
 const details=response();await controller.getTransferRequestDetails({params:{requestId:String(sent.body.data.requestId)},user:{id:String(recipient)}},details);assert.equal(new Date(details.body.data.ticketDetails.schedule.startDate).getTime(),from.getTime());
 const accepted=response();await controller.acceptTransfer({params:{requestId:String(sent.body.data.requestId)},user:{id:String(recipient)}},accepted);assert.equal(accepted.code,200);
 await controller.getPendingTransfers({user:{id:String(recipient)}},response());assert.equal((await require("../models/client/ticketTransferRequest.schema").findById(sent.body.data.requestId)).status,"ACCEPTED");
});
test("pending-list reads hide invalid tickets without rewriting transfer decisions",async()=>{
 const issued=await issueForLifecycle(),recipient=oid(),Request=require("../models/client/ticketTransferRequest.schema");
 const request=await Request.create({sender:buyer,recipient,ticketId:issued._id,ticketCategory:"USER_EVENT"});const controller=require("../controllers/client/ticketTransfer.controller");
 for(const patch of [{refundHold:true},{occurrence:5},{status:"EXPIRED"},{"validSchedule.to":new Date(0)}]){
  await UserTicket.updateOne({_id:issued._id},{$set:patch});const res=response();await controller.getPendingTransfers({user:{id:String(recipient)}},res);assert.equal(res.body.data.length,0);assert.equal((await Request.findById(request._id)).status,"PENDING");
  await UserTicket.updateOne({_id:issued._id},{$set:{refundHold:false,occurrence:0,status:"UNREDEEMED",validSchedule:(await Event.findById(event)).schedule}});
 }
});
async function eventFinance(co) {
 const res=response();await require("../controllers/client/financeDashboard.controller").getFinanceStats({user:{id:String(co)}},res);assert.equal(res.code,200,JSON.stringify(res.body));return res.body.data;
}
test("finance dashboard excludes co-organisers without current finance permission",async()=>{
 await issueForLifecycle();const co=oid();await User.collection.insertOne({_id:co,firstName:"Listing",surname:"Manager",email:"manager@example.test"});await Event.updateOne({_id:event},{$addToSet:{coOrganisers:co}});
 const Invitation=require("../models/client/coOrganiserInvitation.schema"),invite=await Invitation.create({host:owner,coOrganiser:co,coOrganiserEmail:"manager@example.test",status:"ACCEPTED",permissions:["MANAGE_LISTING"],listings:[{listingId:event,listingType:"Event"}]});
 let data=await eventFinance(co);assert.equal(data.breakdown.ticketRevenue,0);assert.equal(data.transactions.length,0);assert.ok(data.weeklyTrends.every(day=>day.rawAmount===0));
 for(const permission of ["VIEW_FINANCES","ALL_ACCESS"]){await Invitation.updateOne({_id:invite._id},{$set:{permissions:[permission]}});data=await eventFinance(co);assert.equal(data.breakdown.ticketRevenue,200);assert.equal(data.transactions.length,1);}
 await Invitation.updateOne({_id:invite._id},{$set:{permissions:["MANAGE_LISTING"]}});data=await eventFinance(co);assert.equal(data.transactions.length,0);
 await Invitation.updateOne({_id:invite._id},{$set:{permissions:["VIEW_FINANCES"],host:oid()}});data=await eventFinance(co);assert.equal(data.transactions.length,0);
 await Invitation.updateOne({_id:invite._id},{$set:{host:owner,status:"DECLINED"}});data=await eventFinance(co);assert.equal(data.transactions.length,0);assert.equal((await eventFinance(owner)).breakdown.ticketRevenue,200);
});
test("finance access is limited to each explicitly assigned event",async()=>{
 await issueForLifecycle();const co=oid(),other=oid();await User.collection.insertOne({_id:co,firstName:"Finance",surname:"Viewer",email:"finance-viewer@example.test"});await Event.updateOne({_id:event},{$addToSet:{coOrganisers:co}});
 await Event.collection.insertOne({_id:other,createdBy:owner,title:"Other",coOrganisers:[co]});await EventBooking.create({...eventData("other-private"),eventId:other,paymentStatus:"COMPLETED"});
 await require("../models/client/coOrganiserInvitation.schema").create({host:owner,coOrganiser:co,coOrganiserEmail:"finance-viewer@example.test",status:"ACCEPTED",permissions:["VIEW_FINANCES"],listings:[{listingId:event,listingType:"Event"}]});
 const data=await eventFinance(co);assert.equal(data.breakdown.ticketRevenue,200);assert.equal(data.transactions.length,1);assert.equal(data.transactions[0].reference,"event-payment");
});
async function ticketRevenueStats() {
 const controller=require("../controllers/client/ticketDashboard.controller"),global=response(),single=response();await controller.getOrganiserTicketStats({user:{id:String(owner)}},global);await controller.getSingleEventTicketStats({params:{eventId:String(event)},user:{id:String(owner)}},single);
 assert.equal(global.code,200,JSON.stringify(global.body));assert.equal(single.code,200,JSON.stringify(single.body));return {global:global.body.data,single:single.body.data};
}
test("ticket revenue excludes unpaid inventory and never reprices completed orders",async()=>{
 const saved=await reserveEventBooking({...eventData(),organiserFeeAmount:1000,organiserPayoutAmount:19000});let stats=await ticketRevenueStats();assert.equal(stats.global.aggregate.grossRevenue,0);assert.equal(stats.single.stats.grossRevenue,0);
 await completePayment(saved.paymentReference,paid(saved.paymentReference,20000));await Ticket.updateOne({_id:ticket},{$set:{"price.amountCents":20000,"commission.percentage":99}});await reserveEventBooking(eventData("still-pending"));stats=await ticketRevenueStats();
 assert.equal(stats.global.aggregate.grossRevenue,200);assert.equal(stats.global.aggregate.netRevenue,190);assert.equal(stats.global.aggregate.avgTicketPrice,100);assert.equal(stats.single.stats.grossRevenue,200);assert.equal(stats.single.stats.netRevenue,190);assert.equal(stats.single.stats.avgTicketPrice,100);assert.equal(stats.single.distribution[0].grossRevenue,200);assert.equal(stats.single.distribution[0].netRevenue,190);
});
test("donation and mixed tier revenue preserve saved fee allocation and minor units",async()=>{
 const donation=oid(),free=oid();await Ticket.collection.insertMany([{_id:donation,eventId:event,name:"Donation",ticketType:"DONATION",currency:{code:"NGN"},totalQuantity:10,soldQuantity:0},{_id:free,eventId:event,name:"Free",ticketType:"FREE",currency:{code:"NGN"},totalQuantity:10,soldQuantity:0}]);
 const items=[{ticketId:ticket,name:"Standard",quantity:1,pricePerUnit:101,totalPrice:101,subtotalAmount:101,organiserFeeAmount:11},{ticketId:donation,name:"Donation",quantity:1,pricePerUnit:202,totalPrice:202,subtotalAmount:202,organiserFeeAmount:0},{ticketId:free,name:"Free",quantity:1,pricePerUnit:0,totalPrice:0,subtotalAmount:0,organiserFeeAmount:0}];
 const saved=await reserveEventBooking({...eventData(),items,subtotalAmount:303,totalAmount:303,organiserFeeAmount:18,organiserPayoutAmount:285});await completePayment(saved.paymentReference,paid(saved.paymentReference,303));
 const revenue=(await require("../services/eventRevenue.service").getEventRevenue([event])).get(String(event));assert.equal(revenue.grossRevenueCents,303);assert.equal(revenue.netRevenueCents,285);assert.equal(revenue.tiers.get(String(ticket)).netRevenueCents,88);assert.equal(revenue.tiers.get(String(donation)).netRevenueCents,197);
 const stats=await ticketRevenueStats();assert.equal(stats.single.stats.grossRevenue,3.03);assert.equal(stats.single.stats.netRevenue,2.85);assert.equal(stats.single.distribution.find(t=>String(t.id)===String(donation)).grossRevenue,2.02);
});
test("refunded and unresolved collected payments are excluded from earned ticket revenue",async()=>{
 const issued=await issueForLifecycle();for(const patch of [{paymentStatus:"REFUNDED"},{paymentStatus:"COMPLETED",paymentResolutionRequired:true},{paymentStatus:"COMPLETED",paymentResolutionRequired:false,status:"CANCELLED"}]){
  await EventBooking.updateOne({_id:issued.bookingId},{$set:patch});const stats=await ticketRevenueStats();assert.equal(stats.global.aggregate.grossRevenue,0);assert.equal(stats.single.stats.grossRevenue,0);
 }
});

test("finance earnings and weekly trends exclude closed and unresolved collected payments", async () => {
  const issued = await issueForLifecycle();
  assert.equal((await eventFinance(owner)).breakdown.ticketRevenue, 200);
  for (const patch of [
    { paymentStatus: "COMPLETED", paymentResolutionRequired: true },
    { paymentStatus: "COMPLETED", paymentResolutionRequired: false, status: "CANCELLED" },
    { paymentStatus: "REFUNDED", paymentResolutionRequired: false, status: "CANCELLED" },
  ]) {
    await EventBooking.updateOne({ _id: issued.bookingId }, { $set: patch });
    const data = await eventFinance(owner);
    assert.equal(data.breakdown.ticketRevenue, 0);
    for (const key of ["totalEarnings", "thisMonthEarnings", "thisWeekEarnings", "todayEarnings"]) assert.equal(data.balance[key], 0);
    assert.ok(data.weeklyTrends.every(day => day.rawAmount === 0));
    assert.notEqual(data.transactions[0].status, "COMPLETED");
  }
});
test("late collected payments never inflate the organiser's finance dashboard", async () => {
  const saved = await reserveEventBooking(eventData("late-finance-check"));
  await Event.updateOne({ _id: event }, { $set: { "schedule.to": new Date(0) } });
  const completed = await completePayment(saved.paymentReference, paid(saved.paymentReference, 20000));
  assert.equal(completed.conflict, true);
  const data = await eventFinance(owner);
  assert.equal(data.breakdown.ticketRevenue, 0);
  assert.equal(data.transactions[0].status, "UNDER_REVIEW");
});
test("organiser and staff previews agree with check-in on ticket expiry and occurrence", async () => {
  const issued = await issueForLifecycle();
  const staff = oid();
  await require("../models/client/staffInvitation.schema").create({ organiser: owner, staff, staffEmail: "gate@example.test",
    status: "ACCEPTED", permissions: ["SCAN_TICKET"], listings: [{ listingId: event, listingType: "Event" }] });
  const ownerPreview = async () => {
    const res = response();
    await require("../controllers/client/userEventTicket.controller").verifyTicket({ body: { ticketNumber: issued.ticketNumber }, user: { id: String(owner) } }, res);
    assert.equal(res.code, 200, JSON.stringify(res.body)); return res.body.data;
  };
  const staffPreview = async () => {
    const res = response();
    await require("../controllers/client/staffScanner.controller").verifyTicketStaff({ params: { listingType: "event", listingId: String(event) }, body: { ticketNumber: issued.ticketNumber }, user: { id: String(staff) } }, res);
    assert.equal(res.code, 200, JSON.stringify(res.body)); return res.body.data;
  };
  assert.equal((await ownerPreview()).canCheckIn, true);
  assert.equal((await staffPreview()).canCheckIn, true);
  for (const patch of [{ "validSchedule.to": new Date(0) }, { occurrence: 7 }]) {
    await UserTicket.updateOne({ _id: issued._id }, { $set: patch });
    for (const preview of [await ownerPreview(), await staffPreview()]) {
      assert.equal(preview.status, "EXPIRED"); assert.equal(preview.entryClosed, true); assert.equal(preview.canCheckIn, false);
    }
    assert.equal(await require("../services/eventEntry.service").checkInEventTicket({ eventId: event, ticketNumber: issued.ticketNumber, actor: owner }), null);
    await UserTicket.updateOne({ _id: issued._id }, { $set: { occurrence: 0, validSchedule: (await Event.findById(event)).schedule } });
  }
  const from = new Date(Date.now() + 3 * 86400000);
  await UserTicket.updateOne({ _id: issued._id }, { $set: { "validSchedule.from": from } });
  assert.equal(new Date((await ownerPreview()).eventDate).getTime(), from.getTime());
});
test("buyer payment history persists review cases and isolates other buyers", async () => {
  const first = await reserveEventBooking(eventData("buyer-review"));
  const second = await reserveEventBooking(eventData("buyer-other"));
  const other = await reserveEventBooking({ ...eventData("private-review"), buyer: oid() });
  await EventBooking.updateMany({ _id: { $in: [first._id, other._id] } }, { $set: { status: "CANCELLED", paymentStatus: "COMPLETED", paymentResolutionRequired: true, checkoutAccessCode: "private-access", initializationToken: "private-token" } });
  const res = response();
  await require("../controllers/client/eventBooking.controller").getMyBookings({ user: { id: String(buyer) }, query: { needsAttention: "true", limit: "1", page: "1" } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.pagination.total, 1); assert.equal(res.body.data.length, 1);
  const row = JSON.parse(JSON.stringify(res.body.data[0]));
  assert.equal(row.paymentReference, first.paymentReference); assert.equal(row.paymentResolutionRequired, true);
  assert.equal(row.checkoutAccessCode, undefined); assert.equal(row.initializationToken, undefined);
  const all = response();
  await require("../controllers/client/eventBooking.controller").getMyBookings({ user: { id: String(buyer) }, query: {} }, all);
  assert.equal(all.body.pagination.total, 2);
  assert.ok(all.body.data.some(booking => String(booking._id) === String(second._id)));
});
test("verification race exposes a closed payment only to its buyer for recovery", async () => {
  const saved = await reserveEventBooking(eventData("review-recovery"));
  await EventBooking.updateOne({ _id: saved._id }, { $set: { status: "CANCELLED", paymentStatus: "COMPLETED", paymentResolutionRequired: true } });
  const controller = require("../controllers/client/eventBooking.controller"), mine = response(), stranger = response();
  await controller.verifyBooking({ user: { id: String(buyer) }, params: { reference: saved.paymentReference } }, mine);
  assert.equal(mine.code, 409); assert.equal(mine.body.data.booking.paymentResolutionRequired, true);
  await controller.verifyBooking({ user: { id: String(owner) }, params: { reference: saved.paymentReference } }, stranger);
  assert.equal(stranger.code, 404); assert.equal(stranger.body.data, undefined);
});
test("refund operations surface legacy records without rewriting their amounts", async () => {
  const legacy = await newRefund({ ticketId: undefined, amountMinor: 1234 });
  const health = await require("../services/refundOperations.service").getRefundOperations();
  assert.equal(health.legacyRefunds, 1);
  assert.ok(health.alerts.some(message => message.includes("legacy refund")));
  assert.equal((await Refund.findById(legacy._id)).amountMinor, 1234);
});

// Security and cross-tier capacity regression tests (temporary replica set only).
const OTP = require("../models/client/otp.schema");
const otpService = require("../services/otp.service");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
process.env.ACCESS_TOKEN_SECRET = "isolated-access-test-secret";
process.env.REFRESH_TOKEN_SECRET = "isolated-refresh-test-secret";
const auth = require("../controllers/client/auth.controller");
const invokeAuth = (handler, body) => new Promise((resolve, reject) => {
  const res = response(); res.json = function(data) { this.body = data; resolve(this); return this; };
  handler({ body }, res, reject);
});
const accessFor = (id, sessionVersion = 0) => jwt.sign({ UserInfo: { id: String(id), sessionVersion } }, process.env.ACCESS_TOKEN_SECRET);
const checkAccess = async token => {
  const res = response(); let allowed = false;
  await require("../middleware/verifyJWT")({ originalUrl: "/api/events", headers: { authorization: "Bearer " + token } }, res,
    error => { if (error) throw error; allowed = true; });
  return { allowed, code: res.code };
};
const seedOTP = (extra = {}) => OTP.create({ identifier: "guest@example.com", type: "password_change", code: "123456", expiresAt: new Date(Date.now() + 600000), ...extra });

test("expired OTP fails before TTL cleanup; previews work but consumption permits one winner", async () => {
  await seedOTP({ expiresAt: new Date(Date.now() - 1) });
  assert.equal((await otpService.verifyOTP("guest@example.com", "123456", "password_change")).success, false);
  await OTP.deleteMany({}); await seedOTP();
  assert.equal((await otpService.verifyOTP("guest@example.com", "123456", "password_change")).success, true);
  const results = await Promise.all([1, 2].map(() => otpService.verifyOTP("guest@example.com", "123456", "password_change", { consume: true })));
  assert.equal(results.filter(r => r.success).length, 1);
  assert.equal((await otpService.verifyOTP("guest@example.com", "123456", "password_change", { consume: true })).success, false);
});

test("OTP attempts are bounded even with concurrent wrong codes", async () => {
  await seedOTP();
  const results = await Promise.all(Array.from({ length: 12 }, () => otpService.verifyOTP("guest@example.com", "000000", "password_change")));
  assert.ok(results.every(r => !r.success));
  assert.equal((await OTP.findOne()).attempts, 5);
  assert.equal((await otpService.verifyOTP("guest@example.com", "123456", "password_change", { consume: true })).success, false);
});

test("password reset consumes OTP, revokes both token types, and allows fresh login", async () => {
  const oldAccess = accessFor(buyer);
  const oldRefresh = jwt.sign({ id: String(buyer), email: "guest@example.com", sessionVersion: 0 }, process.env.REFRESH_TOKEN_SECRET);
  await User.updateOne({ _id: buyer }, { $set: { password: await bcrypt.hash("old-password", 4), refreshToken: oldRefresh, isActive: true } });
  await seedOTP();
  assert.equal((await checkAccess(oldAccess)).allowed, true);
  const reset = await invokeAuth(auth.handleUpdatePassword, { email: "guest@example.com", code: "123456", newPassword: "new-password" });
  assert.equal(reset.code, 200);
  assert.equal((await checkAccess(oldAccess)).allowed, false);
  assert.equal((await invokeAuth(auth.handleRefreshToken, { refreshToken: oldRefresh })).code, 403);
  assert.equal((await invokeAuth(auth.handleUpdatePassword, { email: "guest@example.com", code: "123456", newPassword: "attacker-password" })).code, 400);
  const login = await invokeAuth(auth.handleLogin, { email: "guest@example.com", password: "new-password" });
  assert.equal(login.code, 200);
  assert.equal((await checkAccess(login.body.data.accessToken)).allowed, true);
});

test("reset database failure rolls back OTP consumption and session revocation", async () => {
  await seedOTP();
  mock.method(User, "findOneAndUpdate", async () => { throw Error("database unavailable"); });
  await assert.rejects(invokeAuth(auth.handleUpdatePassword, { email: "guest@example.com", code: "123456", newPassword: "new-password" }), /database unavailable/);
  assert.equal(await OTP.countDocuments(), 1);
  assert.equal((await OTP.findOne()).attempts, 0);
});

test("suspended users cannot login, refresh, or use already issued access tokens", async () => {
  const refreshToken = jwt.sign({ email: "guest@example.com" }, process.env.REFRESH_TOKEN_SECRET);
  await User.updateOne({ _id: buyer }, { $set: { isActive: false, password: await bcrypt.hash("password", 4), refreshToken } });
  assert.equal((await checkAccess(accessFor(buyer))).code, 403);
  assert.equal((await invokeAuth(auth.handleLogin, { email: "guest@example.com", password: "password" })).code, 403);
  assert.equal((await invokeAuth(auth.handleRefreshToken, { refreshToken })).code, 403);
  await User.deleteOne({ _id: buyer });
  assert.equal((await checkAccess(accessFor(buyer))).allowed, false);
});

test("concurrent purchases in different tiers cannot exceed event capacity", async () => {
  await Event.updateOne({ _id: event }, { $set: { capacity: 3 } });
  const other = oid();
  await Ticket.collection.insertOne({ _id: other, eventId: event, name: "VIP", ticketType: "PAID", totalQuantity: 10, soldQuantity: 0 });
  const first = eventData("capacity-first"), second = eventData("capacity-second"); second.items[0].ticketId = other;
  const results = await Promise.allSettled([reserveEventBooking(first), reserveEventBooking(second)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.match(results.find(r => r.status === "rejected").reason.message, /capacity/i);
  assert.equal(await EventBooking.countDocuments(), 1);
  const tiers = await Ticket.find({ eventId: event });
  assert.equal(tiers.reduce((sum, tier) => sum + tier.soldQuantity, 0), 2);
});

test("paid tickets retain capacity; reconciled expiry frees holds; previous occurrences do not count", async () => {
  await Event.updateOne({ _id: event }, { $set: { capacity: 2 } });
  const pending = await reserveEventBooking(eventData("capacity-expired"));
  await EventBooking.updateOne({ _id: pending._id }, { $set: { reservationExpiresAt: new Date(0) } });
  await assert.rejects(reserveEventBooking(eventData("capacity-blocked")), /capacity/);
  await expireEventReservation(pending._id);
  const next = await reserveEventBooking(eventData("capacity-paid"));
  await completePayment(next.paymentReference, paid(next.paymentReference, 20000));
  await assert.rejects(reserveEventBooking(eventData("capacity-after-paid")), /capacity/);
  await Event.updateOne({ _id: event }, { $set: { occurrence: 1 } });
  await reserveEventBooking(eventData("capacity-next-occurrence"));
});

test("capacity edits cannot fall below reservations and honoured tickets count", async () => {
  await validEventFixture();
  await Event.updateOne({ _id: event }, { $set: { capacity: 3 } });
  await reserveEventBooking(eventData("capacity-edit"));
  const controller = require("../controllers/client/event.controller"), res = response();
  await controller.updateEvent({ params: { id: String(event) }, user: { id: String(owner) }, body: { capacity: 1 } }, res);
  assert.equal(res.code, 409);
  assert.equal((await Event.findById(event)).capacity, 3);
  await UserTicket.collection.insertOne({ eventId: event, occurrence: 1, status: "UNREDEEMED", validSchedule: { to: new Date(date) } });
  await assert.rejects(require("../services/eventCapacity.service").assertEventCapacity({ _id: event, occurrence: 1, capacity: 0 }), /capacity/);
});

test("quotes reject duplicate items, too many items, closed sales and tier order limits", async () => {
  const controller = require("../controllers/client/eventBooking.controller");
  const quote = async items => { const res = response(); await controller.quoteBooking({ body: { eventId: String(event), items } }, res); return res; };
  const item = { product: String(ticket), quantity: 1 };
  assert.equal((await quote([item, item])).code, 400);
  assert.equal((await quote(Array.from({ length: 1001 }, () => item))).code, 400);
  await Ticket.updateOne({ _id: ticket }, { $set: { salesStartAt: new Date(Date.now() + 86400000) } });
  assert.equal((await quote([item])).code, 409);
  await Ticket.updateOne({ _id: ticket }, { $unset: { salesStartAt: 1 }, $set: { perTransactionLimit: { min: 2, max: 3 } } });
  assert.equal((await quote([item])).code, 400);
  assert.equal((await quote([{ ...item, quantity: 2 }])).code, 200);
});


test("Google login also rejects a suspended account", async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client";
  mock.method(require("google-auth-library").OAuth2Client.prototype, "verifyIdToken", async () => ({ getPayload: () => ({ email: "guest@example.com", sub: "test-google-id" }) }));
  await User.updateOne({ _id: buyer }, { $set: { isActive: false } });
  assert.equal((await invokeAuth(auth.handleGoogleAuth, { idToken: "test-only-token" })).code, 403);
});

test("management authentication uses the separate staff account and revokes old versions", async () => {
  const Staff = require("../models/management/staff.schema"), id = oid();
  await Staff.collection.insertOne({ _id: id, email: "staff@example.com", roles: ["admin"], isActive: true, sessionVersion: 1 });
  const check = async version => {
    const res = response(); let allowed = false;
    await require("../middleware/verifyJWT")({ originalUrl: "/api/admin/refunds", headers: { authorization: "Bearer " + accessFor(id, version) } }, res,
      error => { if (error) throw error; allowed = true; });
    return { allowed, code: res.code };
  };
  assert.equal((await check(1)).allowed, true);
  assert.equal((await check(0)).code, 401);
  assert.equal((await checkAccess(accessFor(id, 1))).allowed, false);
  await Staff.updateOne({ _id: id }, { $set: { isActive: false } });
  assert.equal((await check(1)).code, 403);
});


test("refund workspace excludes three redeemed holders and flags only the affected holder", async () => {
  const holders = [buyer, oid(), oid(), oid()];
  for (let index = 0; index < 4; index++) {
    const saved = await reserveEventBooking({ ...eventData("holder-attention-" + index), buyer: holders[index] });
    await completePayment(saved.paymentReference, paid(saved.paymentReference, 20000));
    if (index < 3) await UserTicket.updateMany({ bookingId: saved._id }, { $set: { status: "REDEEMED" } });
  }
  await cancel();
  assert.equal(await Refund.countDocuments(), 2);
  await Refund.updateMany({}, { $set: { status: "OVERDUE" } });
  const workspace = require("../controllers/client/refundWorkspace.controller");
  const call = async (method, query = {}) => {
    const res = response();
    await workspace[method]({ params: { id: String(event) }, user: { id: String(owner) }, query: { ticketTypeId: String(ticket), ...query } }, res);
    assert.equal(res.code, 200, JSON.stringify(res.body)); return res.body.data;
  };
  const summary = await call("summary");
  assert.equal(summary.tiers[0].holders, 4);
  assert.equal(summary.tiers[0].pending, 2); // Counts are per ticket; each buyer bought two.
  assert.equal(summary.tiers[0].attention, 2);
  const attention = await call("holders", { filter: "attention" });
  assert.equal(attention.total, 1);
  assert.equal(String(attention.items[0]._id), String(holders[3]));
  assert.equal((await call("holders", { filter: "none" })).total, 3);
  assert.equal((await call("holders", { filter: "all" })).total, 4);
  const detail = await call("holderTickets", { holderId: String(buyer) });
  assert.ok(detail.tickets.every(ticket => ticket.status === "REDEEMED"));
  assert.equal(detail.refunds.length, 0);
  // Missing records for the affected holder must still surface for reconciliation.
  await Refund.deleteMany({});
  assert.equal((await call("holders", { filter: "attention" })).total, 1);
});

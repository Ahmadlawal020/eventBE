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
const Outbox=require("../models/client/notificationOutbox.schema");
const lifecycle=require("../controllers/client/eventLifecycle.controller");
let repl,owner,buyer,event,venue,ticket;
const oid=()=>new mongoose.Types.ObjectId();
const date=new Date(Date.now()+86400000*2).toISOString().slice(0,10);
before(async()=>{
 repl=await MongoMemoryReplSet.create({replSet:{count:1}});
 await mongoose.connect(repl.getUri(),{dbName:"isolated_payment_checkout"});
 await Promise.all([EventBooking,Booking,UserTicket,Payout,Ticket,Refund,Outbox].map(model=>model.init()));
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
 const other=oid();await Ticket.collection.insertOne({_id:other,totalQuantity:0,soldQuantity:0});const data=eventData();data.items.push({ticketId:other,name:"Sold out",quantity:1,pricePerUnit:100,totalPrice:100});await assert.rejects(reserveEventBooking(data),/Not enough/);assert.equal((await Ticket.findById(ticket)).soldQuantity,0);assert.equal(await EventBooking.countDocuments(),0);
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
const cancel=async()=>{const res=response();await lifecycle.cancelEvent({params:{id:String(event)},user:{id:String(owner)},body:{message:"Venue unavailable",confirm:true}},res);assert.equal(res.code,200,JSON.stringify(res.body));return res;};
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
 const call=async(method,user,body={})=>{const res=response();await lifecycle[method]({params:{refundId:String(refund._id)},user:{id:String(user)},body},res);return res;};
 assert.equal((await call("submitBankDetails",buyer,{accountName:"Buyer",accountNumber:"bad",bankCode:"058"})).code,400);
 assert.equal((await call("submitBankDetails",owner,{accountName:"Buyer",accountNumber:"0123456789",bankCode:"058"})).code,409);
 assert.equal((await call("submitBankDetails",buyer,{accountName:"Buyer",accountNumber:"0123456789",bankCode:"058"})).code,200);
 assert.equal((await call("markRefundPaid",owner)).code,409);
 await Refund.updateOne({_id:refund._id},{$set:{receipt:{publicId:"test-proof",format:"png",uploadedAt:new Date()}}});
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
 const res=response();await lifecycle.cancelEvent({params:{id:String(event)},user:{id:String(owner)},body:{message:"Venue unavailable",confirm:true}},res);
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
 const res=response();await lifecycle.submitBankDetails({params:{refundId:String(refund._id)},user:{id:String(buyer)},body:{accountName:" Buyer ",accountNumber:"0123 456-789",bankCode:"058"}},res);
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
 const denied=response();await lifecycle.submitBankDetails(req(buyer),denied);assert.equal(denied.code,409);
 const allowed=response();await lifecycle.submitBankDetails(req(recipient),allowed);assert.equal(allowed.code,200);
 const mine=response();await lifecycle.getMyRefunds({user:{id:String(buyer)}},mine);assert.equal(mine.body.data.length,1);assert.notEqual(String(mine.body.data[0].ticketId),String(gifted._id));
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

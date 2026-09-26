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
let repl,owner,buyer,event,venue,ticket;
const oid=()=>new mongoose.Types.ObjectId();
const date=new Date(Date.now()+86400000*2).toISOString().slice(0,10);
before(async()=>{
 repl=await MongoMemoryReplSet.create({replSet:{count:1}});
 await mongoose.connect(repl.getUri(),{dbName:"isolated_payment_checkout"});
 await Promise.all([EventBooking,Booking,UserTicket,Payout,Ticket].map(model=>model.init()));
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
const eventData=(reference="event-payment")=>({eventId:event,buyer,items:[{ticketId:ticket,name:"Standard",quantity:2,pricePerUnit:10000,totalPrice:20000}],totalAmount:20000,currency:"NGN",paymentMethod:"CARD",paymentStatus:"PENDING",paymentReference:reference});
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

// Does not load .env, connect to MongoDB, or call a payment provider.
process.env.QR_SIGNING_SECRET="payment-unit-test-only";
process.env.PAYSTACK_SUPPORTED_CURRENCIES="NGN";
const {test,mock,afterEach,beforeEach}=require("node:test");
const assert=require("node:assert/strict");
const mongoose=require("mongoose");
const axios=require("axios");
const Event=require("../models/client/event.schema");
const EventBooking=require("../models/client/eventBooking.schema");
const Booking=require("../models/client/eventCenterBooking.schema");
const Venue=require("../models/client/eventCenter.schema");
const Ticket=require("../models/client/eventTicketType.schema");
const UserTicket=require("../models/client/userEventTicket.schema");
const Payout=require("../models/client/venuePayout.schema");
const User=require("../models/client/user.schema");
const Settings=require("../models/management/eventCenterSettings.schema");
const Fees=require("../models/management/platformFees.schema");
const Adapter=require("../services/payment/adapters/paystack.adapter");
const safety=require("../services/checkoutSafety.service");
const {confirmReviewBooking,processVenuePayout}=require("../services/venuePayout.service");
const {calculateEventCenterPricing}=require("../services/ticketFees.service");
const id="507f1f77bcf86cd799439011";
const future=new Date(Date.now()+86400000*2).toISOString().slice(0,10);
const query=value=>({select(){return this},sort(){return this},session:async()=>value,then(resolve,reject){return Promise.resolve(value).then(resolve,reject)}});
const transaction=()=>mock.method(mongoose.connection,"transaction",fn=>fn({testSession:true}));
const response=()=>({code:200,status(code){this.code=code;return this},json(body){this.body=body;return this},send(body){this.body=body;return this}});
const booking=(extra={})=>({_id:id,buyer:"buyer",organiser:"owner",eventCenter:id,status:"ACTIVE",paymentStatus:"PENDING",paymentReference:"saved-ref",totalAmount:1150000,currency:"NGN",totalPrice:{amount:11500,currency:"NGN"},organiserPayoutAmount:10000,bookingUnit:"day",bookingMode:"REVIEW",selectedDates:[{date:future}],save:async function(){return this},...extra});
const payment={status:"success",reference:"saved-ref",amount:1150000,currency:"NGN"};
beforeEach(()=>mock.method(Event,"findOneAndUpdate",()=>query({_id:id,status:"LISTED"})));
afterEach(()=>mock.restoreAll());

test("generic initialization rejects client-supplied payment metadata",async()=>{
 const {initializePayment}=require("../controllers/client/payment.controller");mock.method(Adapter.prototype,"initializePayment",()=>assert.fail("must not initialize"));const res=response();await initializePayment({body:{amount:1,metadata:{type:"EVENT_TICKET"}}},res);assert.equal(res.code,410);
});
test("hourly quote ignores submitted amount and duration",()=>{
 const venue={basePrice:{amount:1000,unit:"hour",currency:"NGN"},availability:{}};
 const quote=safety.venueQuote(venue,{bookingUnit:"hour",duration:99,totalPrice:{amount:1,currency:"NGN"},selectedDates:[{date:future,startTime:"10:00",endTime:"13:00"}]});
 assert.equal(quote.subtotalAmount,3000);assert.equal(quote.duration,3);
 assert.throws(()=>safety.venueQuote(venue,{bookingUnit:"hour",selectedDates:[{date:future,startTime:"13:00",endTime:"12:00"}]}),/end after/);
});
test("date duplicates, wrong unit and unsupported currencies are rejected",()=>{
 const venue={basePrice:{amount:1000,unit:"day",currency:"NGN"}};
 assert.throws(()=>safety.venueQuote(venue,{bookingUnit:"day",selectedDates:[{date:future},{date:future}]}),/Duplicate/);
 assert.throws(()=>safety.venueQuote(venue,{bookingUnit:"hour",selectedDates:[]}),/unit/);
 assert.throws(()=>safety.currencyForCheckout("USD"),/not enabled/);
});
test("custom date price applies to each requested hour through midnight",()=>{
 const result=safety.venueQuote({basePrice:{unit:"hour",amount:1000,currency:"NGN"},availability:{customPrices:[{date:future,amount:1500}]}},{bookingUnit:"hour",selectedDates:[{date:future,startTime:"22:00",endTime:"00:00"}]});assert.equal(result.subtotalAmount,3000);assert.equal(result.selectedDates[0].endTime,"24:00");
});
for(const [name,changes,buyer] of [["underpayment",{amount:1}], ["wrong currency",{currency:"USD"}], ["wrong reference",{reference:"forged"}], ["pending payment",{status:"pending"}], ["another buyer",{},"intruder"]])test(name+" cannot complete a booking",()=>assert.throws(()=>safety.validatePayment(booking(),{...payment,...changes},"EVENT_TICKET",buyer)));
test("unknown payment cannot create a booking from metadata",async()=>{
 transaction();mock.method(EventBooking,"findOne",()=>query(null));mock.method(Booking,"findOne",()=>query(null));await assert.rejects(safety.completePayment("saved-ref",payment),{statusCode:404});
});
test("paid replay does not duplicate event tickets",async()=>{
 transaction();const saved=booking({paymentStatus:"COMPLETED"});mock.method(EventBooking,"findOne",()=>query(saved));mock.method(UserTicket,"find",()=>query([{_id:"existing"}]));mock.method(UserTicket,"insertMany",()=>assert.fail("duplicate tickets"));assert.equal((await safety.completePayment("saved-ref",payment)).changed,false);
});
for(const type of ["EVENT_TICKET","EVENT_CENTER"])for(const paymentStatus of ["REFUNDED","FAILED_REFUND"])test(type+" replay cannot revive "+paymentStatus,async()=>{
 transaction();const saved=booking({status:"CANCELLED",paymentStatus,save:async()=>assert.fail("must not save")});mock.method(EventBooking,"findOne",()=>query(type==="EVENT_TICKET"?saved:null));mock.method(Booking,"findOne",()=>query(type==="EVENT_CENTER"?saved:null));await assert.rejects(safety.completePayment("saved-ref",payment),{statusCode:409});assert.equal(saved.paymentStatus,paymentStatus);
});
test("a late payment is recorded without reviving an expired booking",async()=>{
 transaction();const saved=booking({status:"CANCELLED",paymentStatus:"FAILED"});mock.method(EventBooking,"findOne",()=>query(saved));const result=await safety.completePayment("saved-ref",payment);assert.equal(result.conflict,true);assert.equal(saved.status,"CANCELLED");assert.equal(saved.paymentStatus,"COMPLETED");assert.equal(saved.paymentResolutionRequired,true);
});
test("venue conflict records payment without issuing a ticket",async()=>{
 transaction();const saved=booking();mock.method(Booking,"findOne",()=>query(saved));mock.method(Venue,"findById",()=>query({status:"LISTED",availability:{unavailableSlots:[{date:future,startTime:"12:00",endTime:"14:00",bookingId:"other"}]}}));mock.method(Venue,"updateOne",()=>assert.fail("must not reserve conflicted slot"));const result=await safety.completePayment("saved-ref",payment,{kind:"EVENT_CENTER"});assert.equal(result.conflict,true);assert.equal(saved.ticketNumber,undefined);assert.equal(saved.paymentResolutionRequired,true);
});
test("review checkout reserves dates but creates no payout or ticket before approval",async()=>{
 transaction();const saved=booking();mock.method(Booking,"findOne",()=>query(saved));mock.method(Venue,"findById",()=>query({_id:id,status:"LISTED",availability:{}}));const reserve=mock.method(Venue,"updateOne",async()=>({modifiedCount:1}));mock.method(Payout,"create",()=>assert.fail("must hold funds"));await safety.completePayment("saved-ref",payment,{kind:"EVENT_CENTER"});assert.equal(saved.status,"PENDING_REVIEW");assert.equal(saved.ticketNumber,undefined);assert.equal(reserve.mock.callCount(),1);
});
test("expiry releases event inventory once",async()=>{
 transaction();const saved=booking({inventoryReserved:true,items:[{ticketId:id,quantity:2}]});mock.method(EventBooking,"findOne",()=>query(saved.paymentStatus==="PENDING"?saved:null));const release=mock.method(Ticket,"updateOne",async()=>({modifiedCount:1}));assert.equal(await safety.expireEventReservation(id),true);assert.equal(await safety.expireEventReservation(id),false);assert.equal(release.mock.callCount(),1);assert.equal(saved.inventoryReserved,false);
});
test("free tickets are generated inside the reservation transaction",async()=>{
 transaction();mock.method(Ticket,"findOneAndUpdate",async()=>({_id:id}));mock.method(EventBooking.prototype,"save",async function(){return this});const ticketController=require("../controllers/client/userEventTicket.controller");const create=mock.method(ticketController,"createTicketsForBooking",async(saved,session)=>{assert.equal(session.testSession,true);return []});const saved=await safety.reserveEventBooking({eventId:id,buyer:id,items:[],paymentStatus:"COMPLETED",paymentMethod:"FREE",totalAmount:0});assert.equal(create.mock.callCount(),1);assert.equal(saved.reservationExpiresAt,undefined);
});
function reviewFixture(extra={}){
 transaction();const saved=booking({status:"PENDING_REVIEW",paymentStatus:"COMPLETED",reviewDeadline:new Date(Date.now()+3600000),payoutDestination:{accountName:"Host",accountNumber:"0000000000",bankCode:"000"},...extra});mock.method(Booking,"findById",()=>query(saved));mock.method(Venue,"findById",()=>query({availability:{unavailableDates:[{date:future,bookingId:id}]}}));return saved;
}
test("approval queues one net payout and repeated acceptance is harmless",async()=>{
 const saved=reviewFixture();const create=mock.method(Payout,"create",async()=>[]);assert.equal((await confirmReviewBooking(id,"owner")).changed,true);assert.equal(saved.status,"CONFIRMED");assert.ok(saved.ticketNumber);assert.equal(create.mock.calls[0].arguments[0][0].amountMinor,1000000);assert.equal((await confirmReviewBooking(id,"owner")).changed,false);assert.equal(create.mock.callCount(),1);
});
for(const [name,extra,owner] of [["another organiser",{},"intruder"],["unpaid booking",{paymentStatus:"PENDING"},"owner"],["expired review",{reviewDeadline:new Date(0)},"owner"]])test(name+" cannot queue payout",async()=>{reviewFixture(extra);mock.method(Payout,"create",()=>assert.fail("must not pay"));await assert.rejects(confirmReviewBooking(id,owner));});
test("uncertain transfer is reconciled using the same reference, never submitted twice",async()=>{
 const saved={_id:id,status:"READY",recipientCode:"RCP_test",reference:"venue-"+id,amountMinor:1000000,currency:"NGN",save:async()=>{}};mock.method(Payout,"findOneAndUpdate",()=>query(saved));const transfer=mock.method(Adapter.prototype,"transferToOrganiser",async()=>{throw Error("timeout")});const verify=mock.method(Adapter.prototype,"verifyTransfer",async ref=>{assert.equal(ref,saved.reference);return {status:"success"}});await processVenuePayout(id);assert.equal(saved.status,"SUBMITTING");await processVenuePayout(id);assert.equal(saved.status,"SUCCESS");assert.equal(transfer.mock.callCount(),1);assert.equal(verify.mock.callCount(),1);
});
test("transfer rejection requires attention instead of repeated submission",async()=>{
 const saved={status:"READY",recipientCode:"RCP_test",save:async()=>{}};mock.method(Payout,"findOneAndUpdate",()=>query(saved));mock.method(Adapter.prototype,"transferToOrganiser",async()=>{throw Object.assign(Error("rejected"),{response:{status:400,data:{message:"Insufficient balance"}}})});await processVenuePayout(id);assert.equal(saved.status,"NEEDS_ATTENTION");assert.equal(saved.lastError,"Insufficient balance");
});
for(const mode of ["ORGANISER_CHOICE","PASS_TO_BUYER","ABSORB_BY_ORGANISER"])for(const preference of ["addon","deduct"])test(mode+" respects fee collection policy with "+preference,()=>{
 const result=calculateEventCenterPricing({subtotalAmount:10000,fees:{eventCenterCommission:15},feeMode:preference,feeCollectionMode:mode});const guestPays=mode==="PASS_TO_BUYER"||(mode==="ORGANISER_CHOICE"&&preference==="addon");assert.equal(result.totalAmount,guestPays?11500:10000);assert.equal(result.organiserPayoutAmount,guestPays?10000:8500);assert.equal(result.platformFeeAmount,1500);
});
for(const mode of ["PASS_TO_BUYER","ABSORB_BY_ORGANISER"])test("venue checkout persists "+mode+" before contacting provider",async()=>{
 const {createTicket}=require("../controllers/client/eventCenterTicket.controller");mock.method(Settings,"getSingleton",async()=>new Settings({pricing:{feeCollectionMode:mode}}));mock.method(Fees,"findOneAndUpdate",async()=>({eventCenterCommission:15}));mock.method(User,"findById",who=>query(who==="buyer"?{firstName:"Guest",surname:"Test",email:"guest@example.com"}:{vendorAccountCode:"SUB_TEST"}));mock.method(Venue,"findById",()=>query({_id:id,createdBy:"owner",status:"LISTED",bookingSettings:"INSTANT",basePrice:{unit:"day",amount:10000,currency:"NGN",feeMode:mode==="PASS_TO_BUYER"?"deduct":"addon"},availability:{}}));mock.method(Booking,"findOne",()=>query(null));let saved;mock.method(Booking,"create",async data=>{saved=data;return {...data,_id:id}});mock.method(Booking,"updateOne",async()=>({modifiedCount:1}));mock.method(Adapter.prototype,"initializePayment",async args=>{assert.ok(saved);assert.equal(args.amount,mode==="PASS_TO_BUYER"?11500:10000);assert.equal(args.currency,"NGN");assert.equal(args.reference,saved.paymentReference);return {access_code:"secure-code",authorization_url:"https://checkout.paystack.com/test"}});const res=response();await createTicket({user:{id:"buyer"},body:{eventCenterId:id,bookingUnit:"day",selectedDates:[{date:future}],totalPrice:{amount:1,currency:"NGN"}}},res);assert.equal(res.code,201);assert.equal(res.body.data.access_code,"secure-code");
});
test("adapter sends exact currency and minor-unit amount with saved split fee",async()=>{
 const adapter=new Adapter();adapter.secretKey="isolated-test-key";mock.method(axios,"post",async(url,data)=>{assert.equal(data.currency,"GHS");assert.equal(data.amount,12345);assert.equal(data.subaccount,"SUB_TEST");assert.equal(data.transaction_charge,1000);return {data:{status:true,data:{access_code:"test"}}}});await adapter.initializePayment({email:"test@example.com",amount:123.45,currency:"GHS",reference:"saved",subaccount:"SUB_TEST",transactionCharge:1000});
});

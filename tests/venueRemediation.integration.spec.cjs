process.env.NODE_ENV = "test";
process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
process.env.QR_SIGNING_SECRET = "remediation-tests-only";
const { test, mock } = require("node:test"), assert = require("node:assert/strict");
const mongoose = require("mongoose"), { MongoMemoryReplSet } = require("mongodb-memory-server");
const Venue = require("../models/client/eventCenter.schema"), Booking = require("../models/client/eventCenterBooking.schema");
const Operations = require("../models/client/bookingOperations.schema"), History = require("../models/client/bookingHistory.schema");
const Outbox = require("../models/client/eventCenterRefundOutbox.schema"), Invitation = require("../models/client/staffInvitation.schema");
const { commitVenueUpdate } = require("../services/venueCalendarMutation.service");
const { reserveVenueCheckout, expireVenueCheckout, completePastVenueBookings } = require("../services/venueCheckout.service");
const { completePayment } = require("../services/checkoutSafety.service");
const oid = () => new mongoose.Types.ObjectId();
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
test("venue audit remediation enforces permissions and atomic booking invariants", { timeout: 120000 }, async t => {
 let db;
 try {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri(), { dbName: "isolated_venue_remediation" });
  await Promise.all([Venue.init(), Booking.init(), Operations.init(), History.init(), Outbox.init(), Invitation.init()]);
  async function fixture() {
    return Venue.create({ createdBy: oid(), venueName: "Test hall", status: "LISTED", basePrice: { amount: 100, currency: "NGN", unit: "day" }, availability: { operationalHours: { open: "08:00", close: "20:00" }, unavailableDates: [], unavailableSlots: [] } });
  }
  const manual = (date, extra = {}) => ({ date, type: "MANUAL", bookingId: "manual-test", clientName: "Test guest", totalPrice: 100, depositAmount: 0, paymentStatus: "pending", ...extra });
  const checkout = (venue, date = day(20)) => ({ buyer: oid(), organiser: venue.createdBy, bookingUnit: "day", duration: 1,
    selectedDates: [{ date }], totalPrice: { amount: 100, currency: "NGN" }, subtotalPrice: { amount: 100, currency: "NGN" }, paymentReference: String(oid()), bookingMode: "INSTANT", paymentStatus: "PENDING" });
  const invoke = async (fn, actor, params, body = {}, query = {}) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await fn({ user: { id: String(actor) }, params, body, query },res); return res;
  };
  await t.test("venue operations expose missing workers, stalled payments and payout/reversal exceptions", async () => {
    const Health = require("../models/client/refundWorkerHealth.schema"), Payout = require("../models/client/venuePayout.schema");
    await Health.init();
    const v = await fixture(), b = await Booking.create({ ...checkout(v), eventCenter: v._id, paymentResolutionRequired: true,
      reservationExpiresAt: new Date(Date.now() - 2 * 3600000), refund: { state: "NEEDS_ATTENTION" } });
    await Payout.collection.insertOne({ booking: b._id, reference: "health-" + b._id, status: "NEEDS_ATTENTION" });
    const service = require("../services/venueOperations.service");
    const report = await service.getVenueOperations();
    assert.ok(report.alerts.some(a => a.includes("venue-checkout heartbeat"))); assert.equal(report.paymentBacklog, 1);
    assert.equal(report.refundAttention, 1); assert.equal(report.payoutAttention, 1); assert.ok(report.oldestPaymentSeconds >= 7200);
    await require("../services/eventOperations.service").runWorker("venue-checkout", async () => ({ processed: 1 }));
    assert.equal((await service.getVenueOperations()).alerts.some(a => a.startsWith("venue-checkout")), false);
    await assert.rejects(require("../services/eventOperations.service").runWorker("venue-checkout", async () => { throw Error("test worker failure"); }, { force: true }));
    assert.ok((await service.getVenueOperations()).alerts.some(a => a === "venue-checkout has unresolved errors"));
    await Booking.deleteOne({ _id: b._id }); await Payout.deleteOne({ booking: b._id });
  });
  await t.test("interrupted checkout retries the original reference and immutable split without duplicating occupancy", async () => {
    const v = await fixture(), buyer = oid();
    await require("../models/client/user.schema").collection.insertOne({ _id: buyer, email: "buyer@example.invalid", firstName: "Test", surname: "Buyer" });
    const b = await reserveVenueCheckout(v._id, v.updatedAt, { ...checkout(v), buyer,
      checkoutSnapshotVersion: 1, checkoutSubaccount: "SUB_ORIGINAL", platformFeeAmount: 5,
      guestDetails: { email: "buyer@example.invalid", fullName: "Test Buyer" } });
    const Adapter = require("../services/payment/adapters/paystack.adapter");
    let calls = 0;
    const init = mock.method(Adapter.prototype, "initializePayment", async args => {
      calls++; assert.equal(args.reference, b.paymentReference); assert.equal(args.subaccount, "SUB_ORIGINAL"); assert.equal(args.amount, 100);
      if (calls === 1) throw Error("Simulated timeout");
      return { access_code: "saved-code", authorization_url: "https://checkout.paystack.com/test" };
    });
    const verify = mock.method(Adapter.prototype, "verifyPayment", async () => { throw Object.assign(Error("missing"), { response: { status: 404, data: { message: "Transaction not found" } } }); });
    try {
      const c = require("../controllers/client/eventCenterTicket.controller").createTicket;
      const body = { eventCenterId: String(v._id), bookingUnit: "day", selectedDates: [{ date: day(20) }] };
      let r = await invoke(c, buyer, {}, body); assert.equal(r.code, 202, JSON.stringify(r.body)); assert.equal(r.body.data.reference, b.paymentReference);
      r = await invoke(c, buyer, {}, body); assert.equal(r.code, 201, JSON.stringify(r.body)); assert.equal(r.body.data.access_code, "saved-code");
      r = await invoke(c, buyer, {}, body); assert.equal(r.body.data.access_code, "saved-code"); assert.equal(calls, 2);
      await Booking.updateOne({ _id: b._id }, { $set: { paymentStatus: "COMPLETED" } });
      r = await invoke(c, buyer, {}, body); assert.equal(r.code, 202); assert.equal(r.body.data.reference, b.paymentReference); assert.equal(calls, 2);
      assert.equal(await Booking.countDocuments({ eventCenter: v._id }), 1); assert.equal((await Venue.findById(v._id)).availability.unavailableDates.length, 1);
    } finally { init.mock.restore(); verify.mock.restore(); }
  });
  await t.test("concurrent or uncertain checkout never initializes a second payment", async () => {
    const v = await fixture(), b = await reserveVenueCheckout(v._id, v.updatedAt, { ...checkout(v), checkoutSnapshotVersion: 1, checkoutSubaccount: "SUB_TEST", guestDetails: { email: "test@example.invalid" } });
    const { resumeVenueCheckout } = require("../services/venueCheckoutAttempt.service");
    let calls = 0, release, entered;
    const ready = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
    const gateway = { initializePayment: async () => { calls++; entered(); await hold; throw Error("timeout"); }, verifyPayment: async () => ({ status: "pending" }) };
    const first = resumeVenueCheckout(b._id, gateway); await ready;
    assert.equal((await resumeVenueCheckout(b._id, gateway)).data.checkoutPending, true); release(); await first;
    assert.equal((await resumeVenueCheckout(b._id, gateway)).data.checkoutPending, true); assert.equal(calls, 1);
    await Booking.updateOne({ _id: b._id }, { $set: { reservationExpiresAt: new Date(0) } });
    assert.equal((await resumeVenueCheckout(b._id, gateway)).data.checkoutPending, true); assert.equal(calls, 1);
  });
  await t.test("reschedule requests reject dates outside the platform window before writing notices", async () => {
    const v = await fixture(), b = await Booking.create({ ...checkout(v), eventCenter: v._id, paymentStatus: "COMPLETED" });
    const settings = mock.method(require("../services/eventCenterSettings.service"), "getEventCenterSettings", async () => ({ booking: { maximumBookingWindowMonths: 1 } }));
    try {
      const r = await invoke(require("../controllers/client/venueReschedule.controller").request, b.buyer, { id: String(b._id) }, { dates: [{ date: day(60) }], reason: "Change date" });
      assert.equal(r.code, 400, JSON.stringify(r.body)); assert.match(r.body.message, /platform booking window/);
      assert.notEqual((await Booking.findById(b._id)).rescheduleRequest?.status, "PENDING");
      assert.equal(await Outbox.countDocuments({ "data.ticketId": String(b._id) }), 0);
    } finally { settings.mock.restore(); }
  });
  await t.test("unrelated users cannot delete or reorder venue photos", async () => {
    const v = await fixture(); await Venue.updateOne({ _id: v._id }, { $push: { images: { publicId: "legacy", url: "https://example.test/photo", position: 0 } } });
    for (const remove of [true, false]) await assert.rejects(require("../services/venueMedia.service").changeImages(v._id, oid(), { publicId: "legacy", toPosition: 0 }, remove), { status: 403 });
    assert.equal((await Venue.findById(v._id)).images.length, 1);
  });
  await t.test("calendar-only staff cannot record an opening payment", async () => {
    const v = await fixture(), staff = oid();
    await Invitation.collection.insertOne({ staff, organiser: v.createdBy, status: "ACCEPTED", listings: [{ listingId: v._id }], permissions: ["MANAGE_CALENDAR"] });
    await assert.rejects(commitVenueUpdate(v._id, { availability: { ...v.availability.toObject(), unavailableDates: [manual(day(20), { depositAmount: 40, paymentStatus: "partially_paid" })] } }, v.updatedAt, staff), { status: 403 });
    assert.equal(await Operations.countDocuments({ eventCenter: v._id }), 0);
    assert.equal((await Venue.findById(v._id)).availability.unavailableDates.length, 0);
  });
  await t.test("manual creation commits a snapshot, opening balance and one history entry", async () => {
    const v = await fixture();
    const saved = await commitVenueUpdate(v._id, { availability: { ...v.availability.toObject(), unavailableDates: [manual(day(20), { depositAmount: 40, paymentStatus: "partially_paid" })] } }, v.updatedAt, v.createdBy);
    const record = await Operations.findById(`${v._id}:manual-test`); assert.equal(record.openingPaidMinor, 4000);
    assert.equal(record.bookingSnapshot.totalPrice.currency, "NGN"); assert.equal(await History.countDocuments({ eventCenter: v._id }), 1);
    await commitVenueUpdate(v._id, { basePrice: { amount: 20, currency: "USD", unit: "hour" } }, saved.updatedAt, v.createdBy);
    const [booking] = await require("../services/manualBookingRead.service").getManualBookings([await Venue.findById(v._id).lean()]);
    assert.equal(booking.bookingUnit, "day"); assert.equal(booking.totalPrice.currency, "NGN");
  });
  await t.test("history failure rolls back manual calendar and ledger", async () => {
    const v = await fixture(); const stub = mock.method(History, "create", async () => { throw Error("history unavailable"); });
    try { await assert.rejects(commitVenueUpdate(v._id, { availability: { ...v.availability.toObject(), unavailableDates: [manual(day(20))] } }, v.updatedAt, v.createdBy), /history unavailable/); }
    finally { stub.mock.restore(); }
    assert.equal((await Venue.findById(v._id)).availability.unavailableDates.length, 0); assert.equal(await Operations.countDocuments({ eventCenter: v._id }), 0);
  });
  await t.test("competing checkout attempts reserve the exclusive venue only once", async () => {
    const v = await fixture(); const results = await Promise.allSettled([reserveVenueCheckout(v._id, v.updatedAt, checkout(v)), reserveVenueCheckout(v._id, v.updatedAt, checkout(v))]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await Venue.findById(v._id)).availability.unavailableDates.length, 1); assert.equal(await Booking.countDocuments({ eventCenter: v._id }), 1);
    const fresh = await Venue.findById(v._id);
    await assert.rejects(commitVenueUpdate(v._id, { availability: { ...fresh.availability.toObject(), unavailableDates: [...fresh.availability.unavailableDates.map(d => d.toObject()), manual(day(20))] } }, fresh.updatedAt, v.createdBy), /available|conflict/);
  });
  await t.test("payment retries create one occupancy, history and notification pair", async () => {
    const v = await fixture(), pending = await reserveVenueCheckout(v._id, v.updatedAt, checkout(v));
    const payment = { status: "success", amount: 10000, currency: "NGN", reference: pending.paymentReference };
    await Promise.all([completePayment(pending.paymentReference, payment), completePayment(pending.paymentReference, payment)]);
    assert.equal((await Venue.findById(v._id)).availability.unavailableDates.length, 1);
    assert.equal(await History.countDocuments({ ticket: pending._id, action: "CREATED" }), 1);
    assert.equal(await Outbox.countDocuments({ "data.ticketId": String(pending._id) }), 2);
  });
  await t.test("expired checkout releases dates and a late payment queues a refund", async () => {
    const v = await fixture(), pending = await reserveVenueCheckout(v._id, v.updatedAt, checkout(v));
    await Booking.updateOne({ _id: pending._id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    await expireVenueCheckout(pending._id); assert.equal((await Venue.findById(v._id)).availability.unavailableDates.length, 0);
    const result = await completePayment(pending.paymentReference, { status: "success", amount: 10000, currency: "NGN", reference: pending.paymentReference });
    assert.equal(result.conflict, true); assert.equal(result.booking.refund.state, "QUEUED"); assert.equal(result.booking.ticketNumber, undefined);
  });
  await t.test("past paid venue bookings complete once", async () => {
    const v = await fixture(); const b = await Booking.create({ ...checkout(v, day(-2)), eventCenter: v._id, paymentStatus: "COMPLETED", status: "ACTIVE" });
    await completePastVenueBookings(); await completePastVenueBookings();
    assert.equal((await Booking.findById(b._id)).status, "COMPLETED"); assert.equal(await History.countDocuments({ ticket: b._id, action: "COMPLETED" }), 1);
  });

  await t.test("manual refunds require approval and keep sent and confirmed totals separate", async () => {
    const v = await fixture();
    await commitVenueUpdate(v._id,{ availability: { ...v.availability.toObject(), unavailableDates: [manual(day(20),{ paymentStatus: "paid", depositAmount: 100 })] } },v.updatedAt,v.createdBy);
    const b = await require("../services/bookingAttendance.service").loadBooking(v._id,"manual-test");
    const { saveOperation } = require("../services/bookingOperations.service");
    const payload = { action: "PAYMENT", id: "refund-payment-one", kind: "REFUND", amount: 40, method: "BANK_TRANSFER", reason: "Customer cancellation", expectedRevision: 0 };
    await assert.rejects(saveOperation(v._id,b,payload,v.createdBy),{ status: 409 });
    let record = await saveOperation(v._id,b,{ action: "REFUND_APPROVE", id: "refund-approval-one", amount: 40, reason: "Agreed refund", expectedRevision: 0 },v.createdBy);
    await assert.rejects(saveOperation(v._id,b,{ ...payload, refundId: "refund-approval-one", expectedRevision: record.revision },v.createdBy), /proof/);
    await Operations.updateOne({_id:record._id},{$set:{"refunds.0.settlement":{id:"test-prepared",method:"BANK_TRANSFER"},"refunds.0.receipt":{publicId:"test-private-proof",settlementId:"test-prepared"}}});
    record = await saveOperation(v._id,b,{ ...payload, refundId: "refund-approval-one", expectedRevision: record.revision },v.createdBy);
    const m = require("../services/venueMoney.service").manualMoney(b,record);
    assert.equal(m.refundedMinor,4000); assert.equal(m.confirmedRefundMinor,0);
    record = await saveOperation(v._id,b,{ action: "REFUND_CONFIRM", refundId: "refund-approval-one", reason: "Customer signed receipt 123", expectedRevision: record.revision },v.createdBy);
    assert.equal(require("../services/venueMoney.service").manualMoney(b,record).confirmedRefundMinor,4000);
  });
  await t.test("manual refund settlement locks bank details, validates private proof, and requires the customer to confirm", async () => {
    const service=require("../services/manualRefundSettlement.service"), cloud=require("../utils/cloudinary"), Upload=require("../models/client/manualRefundUpload.schema");
    await Upload.init();
    const v=await fixture(),buyer=oid();
    await commitVenueUpdate(v._id,{availability:{...v.availability.toObject(),unavailableDates:[manual(day(20),{paymentStatus:"paid",depositAmount:100})]}},v.updatedAt,v.createdBy);
    const b=await require("../services/bookingAttendance.service").loadBooking(v._id,"manual-test"), {saveOperation}=require("../services/bookingOperations.service");
    await Operations.updateOne({_id:`${v._id}:manual-test`},{$set:{customerId:buyer}});
    await saveOperation(v._id,b,{action:"REFUND_APPROVE",id:"installment",amount:100,reason:"Agreed cancellation",expectedRevision:0},v.createdBy);
    const args=[v._id,"manual-test"], bank={action:"BANK_DETAILS",accountName:"Ada Guest",accountNumber:"0123456789",bankCode:"058",expectedRevision:1};
    await assert.rejects(service.access(...args,oid()),{status:403});
    const staff=oid(), calendarStaff=oid();
    await Invitation.collection.insertMany([
      {staff,organiser:v.createdBy,status:"ACCEPTED",listings:[{listingId:v._id}],permissions:["MANAGE_BOOKINGS","VIEW_FINANCES"]},
      {staff:calendarStaff,organiser:v.createdBy,status:"ACCEPTED",listings:[{listingId:v._id}],permissions:["MANAGE_CALENDAR","VIEW_FINANCES"]},
    ]);
    assert.equal((await service.access(...args,staff)).manager,true);
    await assert.rejects(service.access(...args,calendarStaff),{status:403});

    await assert.rejects(service.update(...args,v.createdBy,bank),{status:403});
    let details=await service.update(...args,buyer,bank);assert.equal(details.account.accountNumber,"0123456789");
    await assert.rejects(service.update(...args,v.createdBy,{action:"PREPARE",refundId:"installment",method:"BANK_TRANSFER",expectedRevision:1}),{status:409});
    await assert.rejects(service.update(...args,buyer,{action:"PREPARE",refundId:"installment",method:"BANK_TRANSFER",expectedRevision:details.revision}),{status:403});
    details=await service.update(...args,v.createdBy,{action:"PREPARE",refundId:"installment",method:"BANK_TRANSFER",expectedRevision:details.revision});
    assert.equal(details.refunds[0].settlement.bankDetails.accountNumber,"0123456789");
    await assert.rejects(service.update(...args,buyer,{...bank,expectedRevision:details.revision}),{status:409});
    const lock=details.refunds[0].settlement.id;
    const stubs=[mock.method(cloud,"config",()=>({cloud_name:"test-only",api_key:"test-only",api_secret:"test-only"})),mock.method(cloud.utils,"api_sign_request",()=>"fake-signature"),mock.method(cloud.utils,"private_download_url",()=>"https://example.invalid/private-proof")];
    let resource, deleted=[];
    stubs.push(mock.method(cloud.api,"resource",async publicId=>({public_id:publicId,type:"authenticated",resource_type:"image",format:"png",bytes:1234,...resource})));
    stubs.push(mock.method(cloud.uploader,"destroy",async id=>{deleted.push(id);return {result:"ok"};}));
    try {
      await assert.rejects(service.prepareUpload(...args,"installment",buyer,lock),{status:403});
      const auth=await service.prepareUpload(...args,"installment",v.createdBy,lock);assert.equal(auth.parameters.type,"authenticated");
      const proof={publicId:auth.parameters.public_id,settlementId:lock,expectedRevision:details.revision};
      resource={type:"upload"};await assert.rejects(service.completeUpload(...args,"installment",v.createdBy,proof),{status:422});
      assert.equal((await Upload.findOne({publicId:proof.publicId})).state,"PENDING");
      resource={bytes:6*1024*1024};await assert.rejects(service.completeUpload(...args,"installment",v.createdBy,proof),{status:422});
      resource={};
      details=await service.completeUpload(...args,"installment",v.createdBy,proof);
      assert.equal(JSON.stringify(details).includes(proof.publicId),false);
      assert.equal((await service.completeUpload(...args,"installment",v.createdBy,proof)).revision,details.revision);
      await assert.rejects(service.receipt(...args,"installment",oid()),{status:403});
      assert.match((await service.receipt(...args,"installment",buyer)).url,/private-proof/);
      await assert.rejects(service.update(...args,v.createdBy,{action:"RELEASE_PREPARATION",refundId:"installment",expectedRevision:details.revision,confirmNoPayment:true,reason:"test"}),{status:409});
      await assert.rejects(require("../services/venueLifecycle.service").archiveVenue(v._id,v.createdBy),/manual refunds/);
      let record=await saveOperation(v._id,b,{action:"PAYMENT",kind:"REFUND",id:"sent-payment",refundId:"installment",amount:100,method:"BANK_TRANSFER",reason:"Agreed cancellation",expectedRevision:details.revision},v.createdBy);
      await assert.rejects(service.prepareUpload(...args,"installment",v.createdBy,lock),{status:409});
      await assert.rejects(saveOperation(v._id,b,{action:"REFUND_CONFIRM",refundId:"installment",reason:"owner claim",expectedRevision:record.revision},v.createdBy),{status:403});
      const result=await invoke(require("../controllers/client/manualCustomerBooking.controller").confirmRefund,buyer,{venueId:String(v._id),bookingId:"manual-test"},{refundId:"installment"});
      assert.equal(result.code,200,JSON.stringify(result.body));
      assert.equal((await Operations.findById(`${v._id}:manual-test`)).refunds[0].status,"CONFIRMED");
      const orphan=await Upload.create({publicId:"orphan-private-receipt",recordId:`${v._id}:manual-test`,refundId:"installment",owner:v.createdBy,settlementId:lock,expiresAt:new Date(0),cleanupAfter:new Date(0)});
      await Upload.updateOne({publicId:proof.publicId},{$set:{cleanupAfter:new Date(0)}});
      assert.equal((await service.cleanup()).deleted,1);assert.deepEqual(deleted,[orphan.publicId]);assert.equal((await Upload.findOne({publicId:proof.publicId})).state,"ATTACHED");
    } finally { for(const stub of stubs)stub.mock.restore(); }
  });
  await t.test("archive refuses cancelled manual balances and held security deposits", async () => {
    const v=await fixture(), {archiveVenue}=require("../services/venueLifecycle.service");
    let updated=await commitVenueUpdate(v._id,{availability:{...v.availability.toObject(),unavailableDates:[manual(day(20),{paymentStatus:"paid",depositAmount:100})]}},v.updatedAt,v.createdBy);
    await commitVenueUpdate(v._id,{availability:{...updated.availability.toObject(),unavailableDates:[]}},updated.updatedAt,v.createdBy);
    await assert.rejects(archiveVenue(v._id,v.createdBy),/manual refund balances/);
    await Operations.updateOne({_id:`${v._id}:manual-test`},{$set:{openingPaidMinor:0,payments:[{id:"security",kind:"SECURITY_DEPOSIT",amountMinor:1000}]}});
    await assert.rejects(archiveVenue(v._id,v.createdBy),/security deposits/);
    await Operations.updateOne({_id:`${v._id}:manual-test`},{$set:{payments:[]}});
    assert.ok((await archiveVenue(v._id,v.createdBy)).archivedAt);
  });
  await t.test("direct refund installments preserve evidence and require the matching customer confirmation", async () => {
    const Refund = require("../models/client/eventCenterRefund.schema"), service = require("../services/venueRefundInstallments.service");
    const v = await fixture(), b = await Booking.create({ ...checkout(v), eventCenter: v._id, status: "CANCELLED", paymentStatus: "COMPLETED" });
    const refund = await Refund.create({ eventCenterId: v._id, bookingId: b._id, ticketId: b._id, organiser: v.createdBy, buyer: b.buyer, amountMinor: 10000, currency: "NGN", dueAt: new Date(Date.now()+86400000),
      status: "DUE_FROM_ORGANISER", bankDetails: { accountName: "Test Customer", accountNumber: "0123456789", bankCode: "058" }, bankDetailsVersion: 1,
      settlement: { id: "first-part", bankDetailsVersion: 1 }, receipt: { settlementId: "first-part", publicId: "private-test-receipt-one", format: "png", uploadedAt: new Date() } });
    await assert.rejects(service.markPaid(refund._id,oid(),{ settlementId: "first-part", amountMinor:4000,organiserReference:"test" }),{ status:409 });
    await Promise.all([1,2].map(() => service.markPaid(refund._id,v.createdBy,{ settlementId: "first-part", amountMinor:4000,organiserReference:"test" })));
    let saved = await Refund.findById(refund._id); assert.equal(saved.sentMinor,4000); assert.equal(saved.installments.length,1);
    await assert.rejects(service.confirm(refund._id,b.buyer,"wrong"),{ status:409 });
    await service.confirm(refund._id,b.buyer,"first-part");
    saved = await Refund.findById(refund._id); assert.equal(saved.status,"DUE_FROM_ORGANISER"); assert.equal(saved.confirmedMinor,4000); assert.equal(saved.receipt?.uploadedAt,undefined);
    const bankResult = await invoke(require("../controllers/client/eventCenterRefund.controller").submitBankDetails,b.buyer,{ refundId: String(refund._id) },{ accountName:"Changed", accountNumber:"1234567890", bankCode:"058" });
    assert.equal(bankResult.code,409);
    await Refund.updateOne({ _id: refund._id },{ $set: { settlement: { id:"second-part",bankDetailsVersion:1 },receipt: { settlementId:"second-part",publicId:"private-test-receipt-two",format:"png",uploadedAt:new Date() } } });
    await assert.rejects(service.markPaid(refund._id,v.createdBy,{ settlementId:"second-part",amountMinor:6001,organiserReference:"test" }),{ status:409 });
    await service.markPaid(refund._id,v.createdBy,{ settlementId:"second-part",amountMinor:6000,organiserReference:"test" });
    await service.confirm(refund._id,b.buyer,"first-part");
    assert.equal((await Refund.findById(refund._id)).status,"MARKED_PAID");
    const final = await service.confirm(refund._id,b.buyer,"second-part");
    assert.equal(final.status,"CONFIRMED_BY_BUYER"); assert.equal(final.confirmedMinor,10000);
    const evidence = await Refund.findById(refund._id).select("+installments.receipt.publicId");
    assert.equal(evidence.installments[0].receipt.publicId,"private-test-receipt-one"); assert.equal(JSON.stringify(evidence).includes("private-test-receipt"),false);
  });
  await t.test("customer date requests preserve old occupancy until authorised approval", async () => {
    const v = await fixture(), pending = await reserveVenueCheckout(v._id,v.updatedAt,checkout(v));
    await completePayment(pending.paymentReference,{status:"success",amount:10000,currency:"NGN",reference:pending.paymentReference});
    const c = require("../controllers/client/venueReschedule.controller"), params = { id:String(pending._id) };
    const requested = await invoke(c.request,pending.buyer,params,{ dates:[{date:day(22)}],reason:"New event date" });
    assert.equal(requested.code,200,JSON.stringify(requested.body));
    assert.equal(new Date((await Venue.findById(v._id)).availability.unavailableDates[0].date).toISOString().slice(0,10),day(20));
    const requestId=requested.body.data.id;
    assert.equal((await invoke(c.resolve,oid(),params,{action:"ACCEPTED",requestId})).code,403);
    assert.equal((await invoke(c.resolve,v.createdBy,params,{action:"ACCEPTED",requestId})).code,200);
    const saved=await Venue.findById(v._id);assert.equal(saved.availability.unavailableDates.length,1);assert.equal(new Date(saved.availability.unavailableDates[0].date).toISOString().slice(0,10),day(22));
    assert.equal((await invoke(c.resolve,v.createdBy,params,{action:"ACCEPTED",requestId})).code,409);
  });
  await t.test("manual booking codes are single-use and customer views exclude private notes", async () => {
    const v=await fixture(), buyer=oid();
    await commitVenueUpdate(v._id,{availability:{...v.availability.toObject(),unavailableDates:[manual(day(20))]}},v.updatedAt,v.createdBy);
    await Operations.updateOne({_id:`${v._id}:manual-test`},{$set:{privateNotes:"PRIVATE STAFF NOTE"}});
    const c=require("../controllers/client/manualCustomerBooking.controller"),params={venueId:String(v._id),bookingId:"manual-test"};
    assert.equal((await invoke(c.invite,oid(),params)).code,403);
    const invitation=await invoke(c.invite,v.createdBy,params); assert.equal(invitation.code,200);
    assert.equal((await invoke(c.claim,buyer,{}, {token:invitation.body.data.token})).code,200);
    assert.equal((await invoke(c.claim,oid(),{}, {token:invitation.body.data.token})).code,409);
    const mine=await invoke(c.mine,buyer,{}); assert.equal(mine.body.data.length,1);assert.equal(JSON.stringify(mine.body).includes("PRIVATE STAFF NOTE"),false);
    assert.equal((await invoke(c.mine,oid(),{})).body.data.length,0);
  });
  await t.test("only the guest of a completed paid booking can publish one review", async () => {
    const Review=require("../models/client/venueReview.schema"); await Review.init();
    const v=await fixture(), b=await Booking.create({...checkout(v,day(-2)),eventCenter:v._id,paymentStatus:"COMPLETED",status:"COMPLETED"});
    const c=require("../controllers/client/venueReview.controller"),params={id:String(b._id)},body={rating:5,reviewText:"Excellent venue"};
    assert.equal((await invoke(c.create,oid(),params,body)).code,409);
    const results=await Promise.all([1,2].map(()=>invoke(c.create,b.buyer,params,body)));
    assert.deepEqual(results.map(r=>r.code).sort(),[201,409]);
    const published=await invoke(c.public,b.buyer,{eventCenterId:String(v._id)});assert.equal(published.body.data.count,1);
    const review=await Review.findOne({booking:b._id});await invoke(c.moderate,oid(),{id:String(review._id)},{status:"HIDDEN"});
    assert.equal((await invoke(c.public,b.buyer,{eventCenterId:String(v._id)})).body.data.count,0);
  });

  await t.test("notification retries preserve delivered channels and retry email independently", async () => {
    const User = require("../models/client/user.schema"), user = oid();
    await User.collection.insertOne({ _id:user, firstName:"Test", email:"test@example.invalid", pushTokens:[{token:"ExponentPushToken[test]"}] });
    let pushCalls=0,emailCalls=0;
    const push=mock.method(require("../services/notification/push.service"),"sendPushNotifications",async()=>{pushCalls++;return {successCount:1,failureCount:0,invalidTokens:[]};});
    const email=mock.method(require("../services/email.service"),"sendEmail",async()=>{emailCalls++;if(emailCalls===1)throw Error("Simulated email outage");return {id:"test-only"};});
    try {
      const notices=require("../services/eventCenterRefundNotifications.service");
      await notices.queueNotices([{ key:"channel-retry-test",recipient:user,type:"BOOKING_UPDATE",title:"Test",message:"Test only",data:{} }]);
      let notice=await Outbox.findOneAndUpdate({key:"channel-retry-test"},{$set:{lockToken:"first"}},{new:true});
      await assert.rejects(notices.deliverNotice(notice,"first"),/Simulated email outage/);
      notice=await Outbox.findOneAndUpdate({key:"channel-retry-test"},{$set:{lockToken:"second"}},{new:true});
      await notices.deliverNotice(notice,"second");
      assert.equal(pushCalls,1);assert.equal(emailCalls,2);
      assert.equal(await require("../models/client/notification.schema").countDocuments({_id:notice._id}),1);
      assert.ok((await Outbox.findById(notice._id)).completedAt);
   
    } finally { push.mock.restore();email.mock.restore(); }
  });
  for (const listingStatus of ["IN_PROGRESS", "LISTED"]) {
    await t.test("sequential photo uploads preserve saved images on " + listingStatus + " venues", async () => {
      const v = await fixture();
      await Venue.updateOne({ _id: v._id }, { $set: { status: listingStatus, images: [] } });
      const Media = require("../models/client/eventMedia.schema");
      const controller = require("../controllers/client/eventCenter.controller").updateEventCenter;
      const expected = [];
      for (let i = 0; i < 3; i++) {
        const asset = await Media.create({ publicId: "event-media/" + oid(), url: "https://example.test/" + oid() + ".jpg", owner: v.createdBy, state: "READY" });
        expected.push({ publicId: asset.publicId, url: asset.url, position: i });
        const result = await invoke(controller, v.createdBy, { id: String(v._id) }, { images: [{ publicId: asset.publicId, url: asset.url }] });
        assert.equal(result.code, 200, JSON.stringify(result.body));
        const saved = await Venue.findById(v._id).lean();
        assert.deepEqual(saved.images.map(({ publicId, url, position }) => ({ publicId, url, position })), expected);
        assert.equal(saved.status, listingStatus);
        assert.equal((await Media.findById(asset._id)).state, "ATTACHED");
        assert.equal(String((await Media.findById(asset._id)).eventCenterId), String(v._id));
      }
      const retry = await invoke(controller, v.createdBy, { id: String(v._id) }, { images: [expected[2]] });
      assert.equal(retry.code, 200, JSON.stringify(retry.body));
      assert.equal((await Venue.findById(v._id)).images.length, 3);
    });
  }
  await t.test("concurrent policy editors cannot overwrite each other and partial saves preserve other sections", async () => {
    const v = await fixture();
    const controller = require("../controllers/client/eventCenter.controller").updateEventCenter;
    const attempts = await Promise.all([
      invoke(controller, v.createdBy, { id: String(v._id) }, { cancellationPolicy: { maxReschedules: 3 }, expectedUpdatedAt: v.updatedAt }),
      invoke(controller, v.createdBy, { id: String(v._id) }, { cancellationPolicy: { refundDays: 14 }, expectedUpdatedAt: v.updatedAt }),
    ]);
    assert.deepEqual(attempts.map(r => r.code).sort(), [200, 409]);
    const before = await Venue.findById(v._id);
    const result = await invoke(controller, v.createdBy, { id: String(v._id) }, { cancellationPolicy: { noticeHours: 48 }, expectedUpdatedAt: before.updatedAt });
    assert.equal(result.code, 200, JSON.stringify(result.body));
    const saved = await Venue.findById(v._id);
    assert.equal(saved.cancellationPolicy.noticeHours, 48);
    assert.equal(saved.cancellationPolicy.maxReschedules, before.cancellationPolicy.maxReschedules);
    assert.equal(saved.cancellationPolicy.refundDays, before.cancellationPolicy.refundDays);
    const stale = await invoke(controller, v.createdBy, { id: String(v._id) }, { cancellationPolicy: { refundDays: 90 }, expectedUpdatedAt: v.updatedAt });
    assert.equal(stale.code, 409);
  });
  await t.test("manual balance collection updates the calendar once even after an uncertain retry", async () => {
    const v = await fixture();
    await commitVenueUpdate(v._id, { availability: { ...v.availability.toObject(), unavailableDates: [manual(day(20), { depositAmount: 25, paymentStatus: "partially_paid" })] } }, v.updatedAt, v.createdBy);
    const venue = await Venue.findById(v._id).lean();
    const booking = require("../services/manualBookingRead.service").buildManualBookings([venue])[0];
    const service = require("../services/bookingOperations.service");
    const record = await service.getRecord(v._id, booking);
    const payment = { action: "PAYMENT", kind: "PAYMENT", id: "payment-retry-stable", amount: 75, method: "CASH", expectedRevision: record.revision };
    await service.saveOperation(v._id, booking, payment, v.createdBy);
    await service.saveOperation(v._id, booking, payment, v.createdBy);
    const saved = await service.getRecord(v._id, booking);
    assert.equal(saved.payments.filter(p => p.id === payment.id).length, 1);
    assert.equal(service.paymentSummary(booking, saved).balanceMinor, 0);
    assert.equal((await Venue.findById(v._id)).availability.unavailableDates[0].paymentStatus, "paid");
  });
  await t.test("rescheduling permission and cutoff use the policy saved at checkout", async () => {
    const v = await fixture();
    v.cancellationPolicy = { allowGuestCancellation: false, noticeHours: 24, refundDays: 7, refundInstructions: "", allowGuestReschedule: false, rescheduleNoticeHours: 48, rescheduleNoticeUnit: "days" };
    await v.save();
    const b = await reserveVenueCheckout(v._id, v.updatedAt, checkout(v));
    await Booking.updateOne({ _id: b._id }, { $set: { paymentStatus: "COMPLETED" } });
    assert.equal(b.cancellationPolicy.allowGuestReschedule, false);
    assert.equal(b.cancellationPolicy.rescheduleNoticeHours, 48);
    await Venue.updateOne({ _id: v._id }, { $set: { "cancellationPolicy.allowGuestReschedule": true, "cancellationPolicy.rescheduleNoticeHours": 0 } });
    const controller = require("../controllers/client/venueReschedule.controller");
    const params = { id: String(b._id) }, body = { dates: [{ date: day(21) }], reason: "Move the booking" };
    let result = await invoke(controller.request, b.buyer, params, body);
    assert.equal(result.code, 409); assert.match(result.body.message, /does not allow/);
    assert.equal((await invoke(controller.get, b.buyer, params)).body.eligibility.canRequest, false);
    await Booking.updateOne({ _id: b._id }, { $set: { "cancellationPolicy.allowGuestReschedule": true, "cancellationPolicy.rescheduleNoticeHours": 8760 } });
    result = await invoke(controller.request, b.buyer, params, body);
    assert.equal(result.code, 409); assert.match(result.body.message, /notice deadline/);
    assert.notEqual((await Booking.findById(b._id)).rescheduleRequest?.status, "PENDING");
    assert.equal(await Outbox.countDocuments({ "data.ticketId": String(b._id), title: "Date change requested" }), 0);
    await Booking.updateOne({ _id: b._id }, { $set: { "cancellationPolicy.rescheduleNoticeHours": 24 } });
    await Venue.updateOne({ _id: v._id }, { $set: { "cancellationPolicy.allowGuestReschedule": false } });
    result = await invoke(controller.request, b.buyer, params, body);
    assert.equal(result.code, 200, JSON.stringify(result.body)); assert.equal(result.body.data.status, "PENDING");
    assert.equal((await Venue.findById(v._id)).availability.unavailableDates[0].date.toISOString().slice(0, 10), day(20));
    assert.equal((await invoke(controller.get, b.buyer, params)).body.eligibility.canRequest, false);
    // Notice applies to submission; an on-time request can still be resolved before the session starts.
    const withdrawn = await invoke(controller.resolve, b.buyer, params, { action: "WITHDRAWN", requestId: result.body.data.id });
    assert.equal(withdrawn.code, 200);
  });
  await t.test("reschedule sheet availability is private and proposed dates remain free until approval", async () => {
    const v = await fixture();
    const b = await reserveVenueCheckout(v._id, v.updatedAt, checkout(v));
    await Booking.updateOne({ _id: b._id }, { $set: { paymentStatus: "COMPLETED" } });
    const c = require("../controllers/client/venueReschedule.controller"), params = { id: String(b._id) };
    assert.equal((await invoke(c.availability, oid(), params, {}, { month: day(20).slice(0, 7) })).code, 404);
    const available = await invoke(c.availability, b.buyer, params, {}, { month: day(20).slice(0, 7) });
    assert.equal(available.code, 200, JSON.stringify(available.body));
    assert.equal(available.body.data.days.find(row => row.date === day(20)).available, true);
    assert.equal(available.body.data.requiredDuration, 1);
    assert.equal((await invoke(c.request, b.buyer, params, { dates: [{ date: day(21) }, { date: day(22) }], reason: "Change dates" })).code, 409);
    const requested = await invoke(c.request, b.buyer, params, { dates: [{ date: day(21) }], reason: "Change dates" });
    assert.equal(requested.code, 200);
    let current = await Venue.findById(v._id);
    assert.equal(current.availability.unavailableDates.length, 1);
    assert.equal(current.availability.unavailableDates[0].date.toISOString().slice(0, 10), day(20));
    // Another buyer can reserve the proposed date before approval.
    await reserveVenueCheckout(v._id, current.updatedAt, checkout(v, day(21)));
    const approved = await invoke(c.resolve, v.createdBy, params, { action: "ACCEPTED", requestId: requested.body.data.id });
    assert.ok([400, 409].includes(approved.code));
    assert.equal((await Booking.findById(b._id)).rescheduleRequest.status, "PENDING");
    assert.equal((await Booking.findById(b._id)).selectedDates[0].date.toISOString().slice(0, 10), day(20));
  });
  await t.test("approval alone moves occupancy and prevents another booking of the new dates", async () => {
    const v = await fixture(), b = await reserveVenueCheckout(v._id, v.updatedAt, checkout(v));
    await Booking.updateOne({ _id: b._id }, { $set: { paymentStatus: "COMPLETED" } });
    const c = require("../controllers/client/venueReschedule.controller"), params = { id: String(b._id) };
    const requested = await invoke(c.request, b.buyer, params, { dates: [{ date: day(21) }], reason: "Change dates" });
    const approved = await invoke(c.resolve, v.createdBy, params, { action: "ACCEPTED", requestId: requested.body.data.id });
    assert.equal(approved.code, 200, JSON.stringify(approved.body));
    const current = await Venue.findById(v._id);
    assert.equal(current.availability.unavailableDates.length, 1);
    assert.equal(current.availability.unavailableDates[0].date.toISOString().slice(0, 10), day(21));
    await assert.rejects(reserveVenueCheckout(v._id, current.updatedAt, checkout(v, day(21))), /available|conflict/);
  });
  await t.test("signed media attaches only to the owning venue and unrelated storage IDs cannot be removed", async () => {
    const Media=require("../models/client/eventMedia.schema"), v=await fixture(), foreign=await fixture();
    const publicId=`event-media/${oid()}`,url=`https://example.invalid/${publicId}`;
    await Media.create({publicId,url,owner:v.createdBy,state:"READY",expiresAt:new Date(Date.now()+3600000),cleanupAfter:new Date(Date.now()+86400000)});
    await assert.rejects(commitVenueUpdate(foreign._id,{images:[{publicId,url,position:0}]},foreign.updatedAt,foreign.createdBy),{status:400});
    await commitVenueUpdate(v._id,{images:[{publicId,url,position:0}]},v.updatedAt,v.createdBy);
    assert.equal(String((await Media.findOne({publicId})).eventCenterId),String(v._id));
    await assert.rejects(require("../services/venueMedia.service").changeImages(v._id,v.createdBy,{publicId:"unrelated-storage-file"},true),{status:404});
    assert.equal((await Venue.findById(v._id)).images.length,1);
  });
  await t.test("admin calendar distinguishes pending payments and excludes duplicate occupancy and cancellations", async () => {
    const v=await fixture(),b=await reserveVenueCheckout(v._id,v.updatedAt,checkout(v));
    const c=require("../controllers/management/bookings.controller").getVenueCalendar;
    let result=await invoke(c,v.createdBy,{}, {},{venueId:String(v._id),yearMonth:day(20).slice(0,7)});
    assert.equal(result.body.data.events.length,1);assert.equal(result.body.data.events[0].type,"BOOKING_PENDING");
    await completePayment(b.paymentReference,{status:"success",amount:10000,currency:"NGN",reference:b.paymentReference});
    result=await invoke(c,v.createdBy,{}, {},{venueId:String(v._id),yearMonth:day(20).slice(0,7)});
    assert.equal(result.body.data.events.length,1);assert.equal(result.body.data.events[0].type,"BOOKING_CONFIRMED");
    await Booking.updateOne({_id:b._id},{$set:{status:"CANCELLED"}});
    result=await invoke(c,v.createdBy,{}, {},{venueId:String(v._id),yearMonth:day(20).slice(0,7)});assert.equal(result.body.data.events.length,0);
  });
 } finally { mock.restoreAll(); await mongoose.disconnect(); if (db) await db.stop(); }
});

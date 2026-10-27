const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const mongoose = require("mongoose");
const Refund = require("../models/client/eventRefund.schema");

const refundId = "507f1f77bcf86cd799439011";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).toString("base64");
function query(value) {
  return { select() { return this; }, lean() { return this; }, populate() { return this; }, sort() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}
function response() {
  return { code: 200, headers: {}, status(code) { this.code = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; } };
}
function load(file, requireFn) {
  const context = { Buffer, Date, module: { exports: {} }, console: { error() {} }, require: requireFn };
  vm.runInNewContext(fs.readFileSync(require.resolve(file), "utf8"), context);
  return context.module.exports;
}
function receiptHarness({ found = true, race = false, configured = true, providerError = null } = {}) {
  const calls = { uploaded: [], destroyed: [], filters: [] };
  const controller = load("../controllers/client/eventRefundReceipt.controller", name => {
    if (name === "mongoose") return { ...mongoose, connection: { transaction: fn => fn({}) } };
    if (name.endsWith("/eventRefund.schema")) return {
      findOne(filter) { calls.filters.push(filter); return query(found ? { receipt: { publicId: "old-proof", format: "png" } } : null); },
      async findOneAndUpdate(filter, update) { calls.filters.push(filter); calls.update = update; return race ? null : {}; },
    };
    if (name.endsWith("/cloudinary")) return {
      config: () => configured ? { cloud_name: "test", api_key: "test", api_secret: "test" } : {},
      uploader: {
        async upload(data, options) { calls.uploaded.push({ data, options }); if (providerError) throw providerError; return { public_id: "new-proof", format: "png" }; },
        async destroy(id, options) { calls.destroyed.push({ id, options }); },
      },
      utils: { private_download_url(id, format, options) { calls.signed = { id, format, options }; return "https://example.test/private-receipt"; } },
    };
    throw new Error(name);
  });
  return { controller, calls, async upload(body = png) {
    const res = response(); await controller.uploadReceipt({ params: { refundId }, user: { id: "organiser" }, headers: { "x-refund-settlement-id": "test-settlement" }, body }, res); return res;
  }, async read() {
    const res = response(); await controller.getReceipt({ params: { refundId }, user: { id: "viewer" } }, res); return res;
  } };
}
test("receipt uploads are organiser-scoped, private, and replace old storage only after persistence", async () => {
  const f = receiptHarness(); const res = await f.upload();
  assert.equal(res.code, 200);
  assert.equal(f.calls.filters[0].organiser, "organiser");
  assert.equal(f.calls.uploaded[0].options.type, "authenticated");
  assert.equal(f.calls.update.$set.receipt.publicId, "new-proof");
  assert.equal(f.calls.update.$set.receipt.settlementId, "test-settlement");
  assert.equal(f.calls.destroyed[0].id, "old-proof");
  assert.equal(res.body.data.publicId, undefined);
});
test("unauthorized uploads never reach image storage", async () => {
  const f = receiptHarness({ found: false });
  assert.equal((await f.upload()).code, 404);
  assert.equal(f.calls.uploaded.length, 0);
});
test("malformed and oversized receipts are rejected before upload", async () => {
  for (const body of [{}, "abcd", "<script>", "a".repeat(7 * 1024 * 1024)]) {
    const f = receiptHarness();
    assert.equal((await f.upload(body)).code, 400);
    assert.equal(f.calls.uploaded.length, 0);
  }
});
test("a concurrent refund-state change cleans up the uncommitted image", async () => {
  const f = receiptHarness({ race: true });
  assert.equal((await f.upload()).code, 409);
  assert.equal(f.calls.destroyed.length, 1);
  assert.equal(f.calls.destroyed[0].id, "new-proof");
});
test("receipt reads allow only the original buyer or organiser and expire signed URLs", async () => {
  const f = receiptHarness(); const res = await f.read();
  assert.equal(res.code, 200);
  assert.equal(f.calls.filters[0].$or[0].buyer, "viewer");
  assert.equal(f.calls.filters[0].$or[1].organiser, "viewer");
  assert.equal(f.calls.signed.options.type, "authenticated");
  assert.ok(f.calls.signed.options.expires_at <= Math.floor(Date.now() / 1000) + 300);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const denied = receiptHarness({ found: false });
  assert.equal((await denied.read()).code, 404);
  assert.equal(denied.calls.signed, undefined);
});
test("receipt storage IDs and bank account numbers remain hidden in ordinary queries", () => {
  assert.equal(Refund.schema.path("receipt.publicId").options.select, false);
  assert.equal(Refund.schema.path("bankDetails.accountNumber").options.select, false);
});
function refundHarness({ owner = true, updated = true } = {}) {
  const calls = {};
  const controller = load("../controllers/client/eventRefund.controller", name => {
    if (name === "mongoose") return { ...mongoose, connection: { transaction: fn => fn({}) } };
    if (name.endsWith("/event.schema")) return { findById: () => query({ _id: "event", createdBy: owner ? "organiser" : "other" }) };
    if (name.endsWith("/userEventTicket.schema")) return { find(filter) { calls.tickets = filter; return query([{ _id: "ticket", owner: {firstName:"Holder"}, ticketName:"VIP", ticketNumber:"TKT-TEST", ticketTypeId:"tier", ticketSnapshot:{ticketType:"PAID",price:{amount:100}}, transferHistory:[{}] }]); } };
    if (name.endsWith("/eventBooking.schema")) return { find(filter) { calls.bookings = filter; return query([{ items: [{ name: "VIP", quantity: 2 }] }]); } };
    if (name.endsWith("/eventRefund.schema")) return {
      async findOneAndUpdate(filter, update) {
        calls.filter = filter; calls.update = update;
        return updated ? { _id: refundId, buyer: "buyer" } : null;
      },
    };
    if (name.endsWith("/notificationTypes")) return require("../constants/notificationTypes");
    if (name.endsWith("/refundNotifications.service")) return { queueNotices: async notices => { calls.notification = notices[0]; } };
    if (name.endsWith("/notification")) return {
      NOTIFICATION_TYPES: { ORGANISER_REFUND_MARKED_PAID: "PAID" },
      async dispatchNotification(payload) { calls.notification = payload; },
    };
    return {};
  });
  return { calls, async call(method, body = { organiserReference: " TX123 ", settlementId: "test-settlement" }) {
    const res = response();
    await controller[method]({ params: { id: refundId, refundId }, user: { id: "organiser" }, body }, res);
    return res;
  } };
}
test("mark-paid requires a receipt, submitted details, owner access and an unpaid refund atomically", async () => {
  const f = refundHarness(); const res = await f.call("markRefundPaid");
  assert.equal(res.code, 200);
  assert.equal(f.calls.filter.organiser, "organiser");
  assert.equal(f.calls.filter["receipt.uploadedAt"].$type, "date");
  assert.equal(f.calls.filter.markedPaidAt, null);
  assert.equal(f.calls.filter["settlement.id"], "test-settlement");
  assert.equal(f.calls.filter["receipt.settlementId"], "test-settlement");
  assert.equal(f.calls.update.$set.paidSettlementId, "test-settlement");
  assert.ok(f.calls.filter["bankDetails.accountName"].$regex.test("Holder"));
  assert.equal(f.calls.update.$set.organiserReference, "TX123");
  assert.match(f.calls.notification.message, /receipt/);
  const missing = refundHarness({ updated: false });
  assert.equal((await missing.call("markRefundPaid")).code, 409);
  assert.equal(missing.calls.notification, undefined);
});
test("holder lists contain individual tickets and are restricted to the original organiser", async () => {
  const f = refundHarness();
  assert.equal((await f.call("organiserBuyers")).code, 200);
  assert.equal(f.calls.tickets.eventId, "event");
  const result = await f.call("organiserBuyers");
  assert.equal(result.body.data[0].ticketNumber, "TKT-TEST");
  assert.equal(result.body.data[0].ticketKind, "PAID");
  assert.equal(result.body.data[0].transferred, true);
  const denied = refundHarness({ owner: false });
  assert.equal((await denied.call("organiserBuyers")).code, 404);
  assert.equal(denied.calls.bookings, undefined);
});

test("missing storage configuration returns an actionable error without uploading",async()=>{
 const f=receiptHarness({configured:false});const res=await f.upload();assert.equal(res.code,503);assert.equal(res.body.code,"RECEIPT_STORAGE_NOT_CONFIGURED");assert.equal(f.calls.uploaded.length,0);
});
test("invalid storage credentials are distinguishable from invalid images",async()=>{
 const f=receiptHarness({providerError:{http_code:401,message:"private provider error"}});const res=await f.upload();assert.equal(res.code,502);assert.equal(res.body.code,"RECEIPT_STORAGE_AUTH_FAILED");assert.ok(!res.body.message.includes("private provider error"));
 const invalid=await receiptHarness({providerError:{http_code:400,message:"bad image"}}).upload();assert.equal(invalid.code,422);
});

function directHarness({bytes=1000,found=true}={}) {
 const calls={};const saved={settlement:{id:"test-settlement"},updatedAt:new Date(),receipt:{publicId:"old-proof"}};
 const controller=load("../controllers/client/eventRefundReceipt.controller",name=>{
  if(name==="mongoose")return { ...mongoose, connection: { transaction: fn => fn({}) } };
  if(name.endsWith("/refundUploadAttempt.schema"))return { create: async () => {}, findOneAndUpdate: async () => ({}), updateOne: async (filter) => {calls.retired=filter.publicId;} };
  if(name==="crypto")return {randomUUID:()=>"unique-upload"};
  if(name.endsWith("/eventRefund.schema"))return {
   findOne:filter=>{calls.filter=filter;return query(found?saved:null);},
   findOneAndUpdate:async(filter,update)=>{calls.update=update;return found?saved:null;},
  };
  if(name.endsWith("/cloudinary"))return {
   config:()=>({cloud_name:"test-cloud",api_key:"public-key",api_secret:"private-secret"}),
   utils:{api_sign_request:(parameters,secret)=>{calls.signed=parameters;assert.equal(secret,"private-secret");return "signed";}},
   api:{resource:async(publicId,options)=>{calls.resource={publicId,options};return {type:"authenticated",resource_type:"image",format:"png",bytes};}},
   uploader:{destroy:async id=>{calls.destroyed=id;}},
  };
  throw Error(name);
 });
 return {calls,async call(method,publicId=`refund-receipts/${refundId}/unique-upload`){
  const res=response();await controller[method]({params:{refundId},user:{id:"organiser"},body:{publicId,settlementId:"test-settlement"}},res);return res;
 }};
}
test("direct receipt upload signs private parameters without exposing the secret",async()=>{
 const f=directHarness();const res=await f.call("prepareReceiptUpload");assert.equal(res.code,200);assert.equal(f.calls.signed.type,"authenticated");assert.equal(f.calls.signed.overwrite,false);assert.equal(res.body.data.signature,"signed");assert.ok(!JSON.stringify(res.body).includes("private-secret"));
});
test("direct upload completion verifies storage metadata and attaches the reserved asset",async()=>{
 const f=directHarness();const res=await f.call("completeReceiptUpload");assert.equal(res.code,200);assert.equal(f.calls.filter.organiser,"organiser");assert.equal(f.calls.resource.options.type,"authenticated");assert.equal(f.calls.update.$set.receipt.publicId,`refund-receipts/${refundId}/unique-upload`);assert.equal(f.calls.retired,"old-proof");
});
test("direct upload rejects foreign assets, unavailable refunds and oversized images",async()=>{
 assert.equal((await directHarness().call("completeReceiptUpload","other-refund/image")).code,400);
 assert.equal((await directHarness({found:false}).call("completeReceiptUpload")).code,409);
 const large=directHarness({bytes:6*1024*1024});assert.equal((await large.call("completeReceiptUpload")).code,422);assert.equal(large.calls.update,undefined);
});

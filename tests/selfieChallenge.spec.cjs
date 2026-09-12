const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function controller(relative, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve(relative), "utf8"), {
    module, exports: module.exports, console, Date,
    require: name => name === "express-async-handler" ? fn => fn : mocks[name] ?? require(name),
  });
  return module.exports;
}
function response() { return { code: 200, status(code) { this.code=code; return this; }, json(data) { this.data=data; return this; }, set() {} }; }
function setup(challengeResult = null) {
  const calls = { created: [], claims: [] };
  const identity = {
    findOne: () => ({ sort: async () => null }),
    create: async data => { calls.created.push(data); return { ...data, _id: "verification" }; },
  };
  const { submitKyc } = controller("../controllers/client/kyc.controller", {
    "../../models/client/identityVerification.schema": identity,
    "../../models/client/selfieChallenge.schema": {
      findOneAndUpdate: async (...args) => { calls.claims.push(args); return challengeResult; },
    },
    "../../models/client/user.schema": { findByIdAndUpdate: async () => {} },
    "../../utils/cloudinary": { uploader: { destroy: async () => {} } },
  });
  const req = { user: { id: "user-a" }, body: {
    idType: "PP", idFrontImage: { url: "front", publicId: "front" },
    selfieImage: { url: "selfie", publicId: "selfie" },
    selfieChallengeSessionId: "12345678-1234-1234-1234-123456789012",
  } };
  return { submitKyc, req, calls };
}
test("KYC rejects absent challenge session before creating a record", async () => {
  const { submitKyc, req, calls } = setup();
  delete req.body.selfieChallengeSessionId;
  const res=response(); await submitKyc(req,res);
  assert.equal(res.code,400); assert.equal(calls.created.length,0); assert.equal(calls.claims.length,0);
});
test("atomic claim requires the signed-in owner, unused session, and future expiry", async () => {
  const { submitKyc, req, calls } = setup();
  const res=response(); await submitKyc(req,res);
  assert.equal(res.code,409); assert.equal(calls.created.length,0);
  const [filter, update] = calls.claims[0];
  assert.equal(filter.userId,"user-a"); assert.equal(filter.usedAt,null);
  assert.equal(filter.sessionId,req.body.selfieChallengeSessionId);
  assert.ok(filter.expiresAt.$gt instanceof Date);
  assert.ok(update.$set.usedAt instanceof Date);
});
test("valid session remains pending and records only unverified app completion", async () => {
  const session={sessionId:"session",steps:["blink"],usedAt:new Date()};
  const { submitKyc, req, calls }=setup(session);
  const res=response(); await submitKyc(req,res);
  assert.equal(res.code,201);
  assert.equal(calls.created[0].status,"pending");
  assert.equal(calls.created[0].selfieChallenge.assessment,"app_reported_unverified");
});
test("challenge creation is owner-bound with all three movements and ten-minute expiry", async () => {
  let saved;
  const { createSelfieChallenge }=controller("../controllers/client/selfieChallenge.controller", {
    "../../models/client/identityVerification.schema": { exists:async()=>null },
    "../../models/client/selfieChallenge.schema": { findOneAndUpdate:async(...args)=>{saved=args;} },
  });
  const res=response(); await createSelfieChallenge({user:{id:"owner"}},res);
  assert.equal(res.code,201);
  assert.equal(saved[0].userId,"owner");
  assert.equal(res.data.steps.length,3);
  assert.equal(new Set(res.data.steps).size,3);
  assert.equal(res.data.sessionId.length,36);
  assert.ok(res.data.expiresAt.getTime()>Date.now()+590000);
  assert.equal(saved[1].$set.usedAt,null);
});

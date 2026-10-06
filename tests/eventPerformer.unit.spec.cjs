const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function fixture({ owner = true, invited = false } = {}) {
  let write;
  function ObjectId() { return "new-performer"; }
  ObjectId.isValid = () => true;
  const sandbox = { module: { exports: {} }, URL, console, require(id) {
    if (id === "mongoose") return { Types: { ObjectId } };
    if (id.includes("event.schema")) return {
      findById: () => ({ select() { return this; }, lean: async () => ({ createdBy: owner ? "actor" : "owner" }) }),
      findOneAndUpdate: async (filter, update, options) => { write = { filter, update, options }; return { performers: { id: () => ({ name: "Ada" }) } }; },
    };
    return { findOne: () => ({ lean: async () => invited ? {} : null }) };
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/client/eventPerformer.controller"), "utf8"), sandbox);
  return { write: () => write, async save(body, performerId) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await sandbox.module.exports.save({ params: { id: "event", performerId }, user: { id: "actor" }, body }, res); return res;
  } };
}
test("adding a performer atomically appends only allowed fields", async () => {
  const f = fixture(); assert.equal((await f.save({ name: "Ada", role: "DJ", $set: { createdBy: "evil" } })).code, 201);
  assert.equal(f.write().update.$push.performers.name, "Ada"); assert.equal(f.write().update.$push.performers.$set, undefined);
  assert.equal(f.write().options.runValidators, true);
});
test("unauthorized organisers cannot change a lineup", async () => {
  const f = fixture({ owner: false }); assert.equal((await f.save({ name: "Ada" })).code, 403); assert.equal(f.write(), undefined);
});
test("permitted co-organisers can edit and remove a photo", async () => {
  const f = fixture({ owner: false, invited: true }); assert.equal((await f.save({ name: "Ada", image: null }, "performer")).code, 200);
  assert.equal(f.write().filter["performers._id"], "performer"); assert.equal(f.write().update.$set["performers.$.image"], null);
});
test("empty names, unsafe URLs and duplicate platforms fail without writing", async () => {
  for (const body of [{ name: " " }, { name: "Ada", socialLinks: [{ platform: "website", url: "javascript:alert(1)" }] }, { name: "Ada", socialLinks: [{ platform: "website", url: "https://example.com" }, { platform: "website", url: "https://example.org" }] }]) {
    const f = fixture(); assert.equal((await f.save(body)).code, 400); assert.equal(f.write(), undefined);
  }
});

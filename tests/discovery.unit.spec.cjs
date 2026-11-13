const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../services/discoveryPolicy.service");
const now = new Date("2030-01-01T12:00:00Z");
const event = { status:"LISTED",schedule:{ from:"2030-02-01",to:"2030-02-02" } };
const ticket = { ticketType:"PAID",price:{ amountCents:250000 },currency:{ code:"NGN" },
  totalQuantity:10,soldQuantity:2,salesStartAt:"2029-12-01",salesEndAt:"2030-02-01" };
test("eligibility excludes terminal, expired, archived and moderated listings", () => {
  assert.equal(P.eventEligible(event,now),true);
  for (const status of ["CANCELLED","COMPLETED","UNLISTED","ACTION_REQUIRED"]) assert.equal(P.eventEligible({ ...event,status },now),false);
  assert.equal(P.eventEligible({ ...event,schedule:{ from:"2029-01-01" } },now),false);
  assert.equal(P.publicListing({ ...event,moderation:{ status:"UNLISTED" } }),false);
  assert.equal(P.publicListing({ ...event,archivedAt:now }),false);
  assert.equal(P.eventEligible({ ...event,schedule:{ from:"2030-02-01",to:"2029-01-01" } },now),false);
});
test("ticket price comes only from sellable inventory, not expired early-bird or held stock", () => {
  assert.equal(P.sellable(ticket,now),true);
  assert.equal(P.sellable({ ...ticket,soldQuantity:10 },now),false);
  assert.equal(P.sellable({ ...ticket,salesStartAt:"2030-01-02" },now),false);
  assert.equal(P.sellable({ ...ticket,salesEndAt:now },now),false);
  assert.equal(P.sellable({ ...ticket,perTransactionLimit:{ min:9 } },now),false);
  assert.equal(P.sellable({ ...ticket,currency:{ code:"USD" } },now),false);
  assert.equal(P.sellable({ ...ticket,price:{ amountCents:-1 } },now),false);
  assert.equal(P.priceFor([ticket]).amount,2500);
  assert.equal(P.priceFor([{ ...ticket,ticketType:"DONATION",donationRange:{ minCents:50000 } }]).donation,true);
});
test("known age limits use age on event day; unknown ages are not guessed", () => {
  const restricted = { ...event,ageRestriction:{ minAge:18 } };
  assert.equal(P.ageEligible(restricted,null,now),false);
  assert.equal(P.ageEligible(restricted,"2012-02-02",now),false);
  assert.equal(P.ageEligible(restricted,"2012-02-01",now),true);
});
test("repeated browsing is capped and impressions do not imply interest", () => {
  const listings = new Map([["Event:e",{ eventType:"MUSIC_CONCERTS" }]]);
  const click = { entityType:"Event",entityId:"e",type:"click",occurredAt:now };
  const one = P.affinities([click],listings,now);
  assert.deepEqual(P.affinities(Array(200).fill(click),listings,now),one);
  assert.equal(P.affinities([{ ...click,type:"impression" }],listings,now).samples,0);
  assert.ok(P.affinities([{ ...click,type:"attendance" }],listings,now).events.MUSIC_CONCERTS > one.events.MUSIC_CONCERTS);
  assert.ok(P.affinities([{ ...click,occurredAt:new Date(+now-90*P.DAY) }],listings,now).events.MUSIC_CONCERTS < one.events.MUSIC_CONCERTS);
});
test("sensitive categories are not inferred and event interest does not imply venue intent", () => {
  const evidence = [{ entityType:"Event",entityId:"e",type:"purchase",occurredAt:now }];
  assert.deepEqual(P.affinities(evidence,new Map([["Event:e",{ eventType:"RELIGION_SPIRITUALITY" }]]),now).events,{});
  assert.deepEqual(P.affinities(evidence,new Map([["Event:e",{ eventType:"MUSIC_CONCERTS" }]]),now).venues,{});
});
test("client cannot declare authoritative purchases, saves or attendance", () => {
  const valid = { requestId:"01234567-0123-4123-8123-012345678901",events:[{ type:"click",entityType:"Event",entityId:"012345678901234567890123" }] };
  assert.equal(P.validateBatch(valid).length,1);
  for (const type of ["purchase","attendance","save","booking"]) assert.throws(() => P.validateBatch({ ...valid,events:[{ ...valid.events[0],type }] }));
  assert.throws(() => P.validateBatch({ ...valid,events:Array(31).fill(valid.events[0]) }));
  assert.throws(() => P.validateBatch({ ...valid,events:[{ ...valid.events[0],entityId:{ $ne:null } }] }));
});
test("ranking prefers explicit interests and city, while limiting organiser concentration", () => {
  const profile = { events:{},venues:{} };
  const preference = { eventTypes:["MUSIC_CONCERTS"] };
  const music = { ...event,eventType:"MUSIC_CONCERTS",location:{ city:"Lagos" } };
  const other = { ...event,eventType:"SPORTS_FITNESS",location:{ city:"Abuja" } };
  assert.ok(P.rank(music,"Event",profile,preference,{ city:"Lagos" },now).score > P.rank(other,"Event",profile,preference,{ city:"Lagos" },now).score);
  assert.deepEqual(P.diversify([{ id:1,createdBy:"a" },{ id:2,createdBy:"a" },{ id:3,createdBy:"a" },{ id:4,createdBy:"b" }],3).map(x=>x.id),[1,2,4]);
  assert.equal(P.distanceKm({},{}),null);
  assert.equal(P.distanceKm({ latitude:0,longitude:0 },{ latitude:0,longitude:0 }),0);
});

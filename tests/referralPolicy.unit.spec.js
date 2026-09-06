const test = require("node:test");
const assert = require("node:assert/strict");
const { addPeriod, resolvePolicy } = require("../utils/referralPolicy");
const global = (revisions = []) => ({ key:"GLOBAL", scope:"GLOBAL", revisions:[
  {version:1,effectiveAt:new Date(0),commissionPercentage:5,duration:{value:90,unit:"DAYS"},
    entryWindow:{value:2,unit:"WEEKS"},status:"ACTIVE",userIds:[],priority:0},
  ...revisions,
] });
const group = (key, rate, priority=0) => ({key:"GROUP:"+key,scope:"GROUP",revisions:[
  {version:1,effectiveAt:new Date(0),commissionPercentage:rate,status:"INHERIT",userIds:["alice"],priority}
]});
test("entry weeks convert to exact days", () => assert.equal(addPeriod("2026-01-01T12:00:00Z",{value:2,unit:"WEEKS"}).toISOString(),"2026-01-15T12:00:00.000Z"));
test("calendar month clamps end-of-month and preserves UTC time", () => assert.equal(addPeriod("2026-01-31T12:30:00Z",{value:1,unit:"MONTHS"}).toISOString(),"2026-02-28T12:30:00.000Z"));
test("calendar month handles leap years", () => assert.equal(addPeriod("2028-01-31T12:30:00Z",{value:1,unit:"MONTHS"}).toISOString(),"2028-02-29T12:30:00.000Z"));
test("legacy unlimited earning period remains representable", () => assert.equal(addPeriod(new Date(),{value:0,unit:"DAYS"}),null));
test("global defaults apply without overrides", () => assert.equal(resolvePolicy([global()],"alice").commissionPercentage,5));
test("a selected group overrides the global rate", () => assert.equal(resolvePolicy([global(),group("a",8)],"alice").commissionPercentage,8));
test("unselected users do not inherit group rates", () => assert.equal(resolvePolicy([global(),group("a",8)],"bob").commissionPercentage,5));
test("higher group priority wins", () => assert.equal(resolvePolicy([global(),group("a",8,20),group("b",9,10)],"alice").commissionPercentage,8));
test("individual rate wins and blank duration inherits", () => {
  const individual={key:"USER:alice",scope:"USER",targetUser:"alice",revisions:[{version:1,effectiveAt:new Date(0),commissionPercentage:12,status:"INHERIT"}]};
  const result=resolvePolicy([global(),group("a",8),individual],"alice");
  assert.equal(result.commissionPercentage,12); assert.deepEqual(result.duration,{value:90,unit:"DAYS"});
});
for(const status of ["PAUSED","ENDED"]) test("global "+status+" gates active individual overrides", () => {
  const g=global(); g.revisions[0].status=status;
  const individual={key:"USER:alice",scope:"USER",targetUser:"alice",revisions:[{version:1,effectiveAt:new Date(0),commissionPercentage:12,status:"ACTIVE"}]};
  assert.equal(resolvePolicy([g,individual],"alice").status,status);
});
test("future rate changes cannot change old transaction policy", () => {
  const g=global([{version:2,effectiveAt:new Date("2026-04-01"),commissionPercentage:15,status:"ACTIVE",duration:{value:3,unit:"MONTHS"},entryWindow:{value:7,unit:"DAYS"}}]);
  assert.equal(resolvePolicy([g],"alice",new Date("2026-03-31")).commissionPercentage,5);
  assert.equal(resolvePolicy([g],"alice",new Date("2026-04-02")).commissionPercentage,15);
});
test("a pause interval stays paused after resume for delayed transactions", () => {
  const original=global().revisions[0];
  const g=global([{...original,version:2,effectiveAt:new Date("2026-03-01"),status:"PAUSED"},
    {...original,version:3,effectiveAt:new Date("2026-04-01"),status:"ACTIVE"}]);
  assert.equal(resolvePolicy([g],"alice",new Date("2026-03-15")).status,"PAUSED");
  assert.equal(resolvePolicy([g],"alice",new Date("2026-04-15")).status,"ACTIVE");
});
test("group membership changes are versioned", () => {
  const g=group("a",8);
  g.revisions.push({...g.revisions[0],version:2,effectiveAt:new Date("2026-03-01"),userIds:["bob"]});
  assert.equal(resolvePolicy([global(),g],"alice",new Date("2026-02-01")).commissionPercentage,8);
  assert.equal(resolvePolicy([global(),g],"alice",new Date("2026-04-01")).commissionPercentage,5);
});
test("resume keeps the original earning-period start", () => {
  const startedAt=new Date("2026-01-01"), original={...global().revisions[0],startedAt};
  const g=global([{...original,version:2,effectiveAt:new Date("2026-03-01"),status:"PAUSED"},
    {...original,version:3,effectiveAt:new Date("2026-04-01"),status:"ACTIVE"}]);
  assert.equal(resolvePolicy([g],"alice",new Date("2026-04-15")).startedAt.getTime(),startedAt.getTime());
});

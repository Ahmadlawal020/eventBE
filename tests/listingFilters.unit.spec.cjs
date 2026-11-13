const test=require("node:test"),assert=require("node:assert/strict");
const Event=require("../models/client/event.schema"),Venue=require("../models/client/eventCenter.schema");
const {getListings}=require("../controllers/client/listings.controller");
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test("listing filters reject malformed prices, reversed budgets and fractional capacity",async()=>{
 for(const query of [{minPrice:"-1"},{maxPrice:"Infinity"},{minPrice:"100",maxPrice:"20"},{minCapacity:"1.5"},{bookingType:"invalid"}]){
  const res=response();await getListings({query},res);assert.equal(res.code,400);
 }
});
test("venue filters match their labels and return the filtered base price and unit",async t=>{
 t.mock.method(Event,"find",()=>{throw Error("Venue-only filters must not fetch events");});
 t.mock.method(Venue,"find",filter=>{
  assert.equal(filter.archivedAt,null);assert.deepEqual(filter["moderation.status"],{$nin:["UNLISTED","CANCELLED"]});
  assert.deepEqual(filter["capacity.max"],{$gte:50});assert.deepEqual(filter.amenities,{$all:["WIFI","PARKING"]});
  assert.equal(filter.bookingSettings,"INSTANT");assert.deepEqual(filter["basePrice.amount"],{$gte:100,$lte:200});
  return {lean:async()=>[{_id:"venue",status:"LISTED",basePrice:{amount:150,currency:"NGN",unit:"hour"},weekendPrice:{amount:80,currency:"NGN"}}]};
 });
 const res=response();await getListings({query:{listingType:"eventCenter",minCapacity:"50",amenities:["WIFI","PARKING"],bookingType:"INSTANT",minPrice:"100",maxPrice:"200"}},res);
 assert.equal(res.code,200);assert.equal(res.body.data[0].price.amount,150);assert.equal(res.body.data[0].price.unit,"hour");
});

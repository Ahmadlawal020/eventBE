// Uses only an isolated local replica set, never application credentials or remote data.
process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { randomUUID } = require("node:crypto");
const { Preference,Behavior,FeedRequest } = require("../models/client/discovery.schema");
const Event = require("../models/client/event.schema");
const Venue = require("../models/client/eventCenter.schema");
const User = require("../models/client/user.schema");
const Order = require("../models/client/eventBooking.schema");
const Ticket = require("../models/client/eventTicketType.schema");
const UserTicket = require("../models/client/userEventTicket.schema");
const VenueBooking = require("../models/client/eventCenterBooking.schema");
const Attendance = require("../models/client/bookingAttendance.schema");
const service = require("../services/discovery.service");
const oid = () => new mongoose.Types.ObjectId();
test("discovery privacy, trust, bounded eligibility and transactional wishlist integration", { timeout:120000 }, async t => {
  let database;
  const userId=oid(),owner=oid(),eventId=oid(),venueId=oid(),now=new Date();
  try {
    database=await MongoMemoryReplSet.create({ replSet:{ count:1 } });
    await mongoose.connect(database.getUri(),{ dbName:"isolated_discovery" });
    for (const model of [Preference,Behavior,FeedRequest,Event,Venue,User,Order,Ticket,UserTicket,VenueBooking,Attendance]) await model.init();
    await User.collection.insertOne({ _id:userId,firstName:"Reader",surname:"Test",email:"reader@example.invalid",dob:new Date("1990-01-01"),wishlistEvents:[],wishlistEventCenters:[] });
    await Event.collection.insertOne({ _id:eventId,title:"Music",status:"LISTED",eventType:"MUSIC_CONCERTS",createdBy:owner,capacity:10,
      schedule:{ from:new Date(+now+86400000),to:new Date(+now+172800000) },location:{ city:"Lagos",countryCode:"NG" },entry:{ ticketRequired:true },occurrence:0 });
    await Ticket.collection.insertOne({ eventId,ticketType:"PAID",price:{ amountCents:100000 },currency:{ code:"NGN" },totalQuantity:10,soldQuantity:0,
      salesStartAt:new Date(+now-86400000),salesEndAt:new Date(+now+86400000) });
    await Venue.collection.insertOne({ _id:venueId,venueName:"Hall",status:"LISTED",venueType:"BANQUET_HALL",createdBy:owner,
      location:{ city:"Lagos",countryCode:"NG" },basePrice:{ amount:10000,currency:"NGN",unit:"day" } });
    await t.test("anonymous feed is contextual and does not persist personal history", async () => {
      const feed=await service.home(null,{ nearbyCity:"Lagos",nearbyCountryCode:"NG" });
      assert.equal(feed.trackingEnabled,false);
      assert.equal(feed.sections.flatMap(s=>s.items).length,2);
      assert.equal(await FeedRequest.countDocuments(),0);
      const venue=feed.sections.flatMap(s=>s.items).find(x=>x.type==="eventCenter");
      assert.equal(venue.admission,"CHECK_AVAILABILITY");
      assert.equal(venue.availability,undefined);
      assert.equal(venue.createdBy,undefined);
    });
    await t.test("legacy country names match codes without overriding conflicting codes", async () => {
      const legacy=oid(), conflicting=oid();
      await Venue.collection.insertMany([
        { _id:legacy,venueName:"Legacy hall",status:"LISTED",createdBy:owner,
          location:{city:"Lagos",country:"Nigeria"},basePrice:{amount:10000,currency:"NGN",unit:"day"} },
        { _id:conflicting,venueName:"Conflicting hall",status:"LISTED",createdBy:owner,
          location:{city:"Lagos",country:"Nigeria",countryCode:"GB"},basePrice:{amount:10000,currency:"NGN",unit:"day"} },
      ]);
      try {
        const result=await service.home(null,{city:"Lagos",countryCode:"NG"});
        const ids=result.sections.flatMap(s=>s.items).map(x=>String(x.id));
        assert.ok(ids.includes(String(legacy)));
        assert.ok(!ids.includes(String(conflicting)));
      } finally { await Venue.deleteMany({_id:{$in:[legacy,conflicting]}}); }
    });
    await t.test("automatic location guides ranking but explicit searches stay strict", async () => {
      const automatic=await service.home(null,{nearbyCity:"Unknown district",nearbyCountryCode:"NG"});
      assert.ok(automatic.sections.flatMap(s=>s.items).length>0);
      assert.equal(automatic.locationLabel,"Unknown district, NG");
      const explicit=await service.home(null,{city:"Unknown district",countryCode:"NG"});
      assert.equal(explicit.sections.length,0);
      assert.equal(explicit.locationNotice,undefined);
    });
    await t.test("a single local venue does not hide other areas and interests rank both types together", async () => {
      const remote=oid(), local=oid();
      await Venue.collection.insertMany([
        { _id:remote,venueName:"Preferred remote venue",venueType:"BANQUET_HALL",status:"LISTED",createdBy:owner,
          location:{city:"Abuja",countryCode:"NG"},basePrice:{amount:10000,currency:"NGN",unit:"day"} },
        { _id:local,venueName:"Only local venue",venueType:"BANQUET_HALL",status:"LISTED",createdBy:owner,
          location:{city:"Small town",countryCode:"NG"},basePrice:{amount:10000,currency:"NGN",unit:"day"} },
      ]);
      const viewer=oid();
      await User.collection.insertOne({_id:viewer,dob:new Date("1990-01-01")});
      await Preference.create({userId:viewer,venueTypes:["BANQUET_HALL"],enabled:false});
      try {
        const result=await service.home(viewer,{nearbyCity:"Small town",nearbyCountryCode:"NG"});
        const items=result.sections.flatMap(s=>s.items);
        assert.equal(items.length,4);
        assert.equal(items[0].id,String(local));
        assert.ok(items.findIndex(x=>x.id===String(remote))<items.findIndex(x=>x.id===String(eventId)));
        assert.equal(items.filter(x=>x.type==="eventCenter").length,3);
        assert.equal(items.filter(x=>x.type==="event").length,1);
      } finally {
        await Venue.deleteMany({_id:{$in:[remote,local]}});
        await User.deleteOne({_id:viewer});
        await Preference.deleteOne({userId:viewer});
        await FeedRequest.deleteMany({userId:viewer});
      }
    });
    await t.test("skipping interests still enables tracking and legacy defaults upgrade once", async () => {
      const viewer=oid();
      await User.collection.insertOne({_id:viewer,dob:new Date("1990-01-01")});
      try {
        const result=await service.home(viewer,{});
        assert.equal(result.trackingEnabled,true);
        assert.equal((await service.preferences(viewer)).enabled,true);
        await Preference.updateOne({userId:viewer},{$set:{enabled:false}});
        const upgraded=await service.preferences(viewer);
        assert.equal(upgraded.enabled,true);
        assert.equal(upgraded.revision,1);
        assert.equal((await service.preferences(viewer)).revision,1);
        const saved=await service.updatePreferences(viewer,{revision:1,enabled:false});
        assert.equal(saved.enabled,true);
      } finally {
        await User.deleteOne({_id:viewer});
        await Preference.deleteOne({userId:viewer});
        await FeedRequest.deleteMany({userId:viewer});
      }
    });
    let pref,feed;
    await t.test("personalization is enabled by default and explicit preferences still work", async () => {
      assert.equal((await service.preferences(userId)).enabled,true);
      pref=await service.updatePreferences(userId,{ revision:0,enabled:true,eventTypes:["MUSIC_CONCERTS"] });
      feed=await service.home(userId,{ nearbyCity:"Lagos" });
      assert.equal(feed.trackingEnabled,true);
      assert.equal(feed.sections[0].title,"Based on your interests");
    });
    await t.test("retries deduplicate and submitted authoritative signals are rejected",async () => {
      const body={ requestId:feed.requestId,events:[{ type:"impression",entityType:"Event",entityId:String(eventId) }] };
      await service.ingest(userId,body); await service.ingest(userId,body);
      assert.equal(await Behavior.countDocuments(),1);
      await assert.rejects(service.ingest(userId,{ ...body,events:[{ ...body.events[0],type:"purchase" }] }));
      await assert.rejects(service.ingest(oid(),body),e=>e.status===409);
      await assert.rejects(service.ingest(userId,{ ...body,events:[{ ...body.events[0],entityId:String(oid()) }] }));
    });
    await t.test("reset rejects late telemetry and erases history without deleting transactions", async () => {
      pref=await service.updatePreferences(userId,{ revision:pref.revision },true);
      assert.equal(await Behavior.countDocuments(),0);
      assert.equal(await FeedRequest.countDocuments(),0);
      await assert.rejects(service.ingest(userId,{ requestId:feed.requestId,events:[{ type:"click",entityType:"Event",entityId:String(eventId) }] }),e=>e.status===409);
      await assert.rejects(service.updatePreferences(userId,{ revision:0,enabled:false }),e=>e.status===409);
    });
    await t.test("concurrent reset and batch never leave erased evidence",async () => {
      feed=await service.home(userId,{ nearbyCity:"Lagos" });
      const result=await Promise.allSettled([
        service.ingest(userId,{ requestId:feed.requestId,events:[{ type:"engaged",entityType:"Event",entityId:String(eventId) }] }),
        service.updatePreferences(userId,{ revision:pref.revision },true),
      ]);
      assert.equal(result[1].status,"fulfilled");
      pref=result[1].value;
      assert.equal(await Behavior.countDocuments(),0);
    });
    await t.test("expired requests are rejected before TTL deletion",async () => {
      const requestId=randomUUID();
      await FeedRequest.create({ requestId,userId,revision:pref.revision,algorithmVersion:"test",expiresAt:new Date(+now-1000),entries:[] });
      await assert.rejects(service.ingest(userId,{ requestId,events:[{ type:"click",entityType:"Event",entityId:String(eventId) }] }),e=>e.status===409);
    });
    await t.test("persisted fulfilled orders and attendee ownership provide strong evidence",async () => {
      const current=new Date(),other=oid();
      await Order.collection.insertMany([
        { buyer:userId,eventId,paymentStatus:"COMPLETED",status:"CANCELLED",totalAmount:100,createdAt:current },
        { buyer:userId,eventId,paymentStatus:"PENDING",status:"ACTIVE",totalAmount:100,createdAt:current },
        { buyer:other,eventId,paymentStatus:"COMPLETED",status:"ACTIVE",totalAmount:100,createdAt:current },
      ]);
      let state=await service.initialProfile(userId,await service.preferences(userId),await User.findById(userId).lean(),new Date());
      assert.equal(state.profile.samples,0);
      const paidOrder=oid();
      await Order.collection.insertOne({ _id:paidOrder,buyer:userId,eventId,paymentStatus:"COMPLETED",status:"ACTIVE",totalAmount:100,createdAt:new Date() });
      state=await service.initialProfile(userId,await service.preferences(userId),await User.findById(userId).lean(),new Date());
      assert.ok(state.profile.events.MUSIC_CONCERTS>0);
      await Order.deleteOne({ _id:paidOrder });
      await UserTicket.collection.insertOne({ owner:userId,eventId,status:"REDEEMED",redeemedAt:new Date(),occurrence:0 });
      state=await service.initialProfile(userId,await service.preferences(userId),await User.findById(userId).lean(),new Date());
      assert.ok(state.profile.events.MUSIC_CONCERTS>0);
      await UserTicket.deleteMany({});
    });
    await t.test("venue review is intent, confirmation is booking evidence, attendance is separately correctable",async () => {
      const booking=oid();
      await VenueBooking.collection.insertOne({ _id:booking,buyer:userId,eventCenter:venueId,paymentStatus:"COMPLETED",
        status:"PENDING_REVIEW",bookingMode:"REVIEW",createdAt:new Date() });
      const profile=async()=>service.initialProfile(userId,await service.preferences(userId),await User.findById(userId).lean(),new Date());
      assert.equal((await profile()).profile.samples,0);
      await VenueBooking.collection.updateOne({ _id:booking },{ $set:{ status:"CONFIRMED" } });
      const confirmed=(await profile()).profile.venues.BANQUET_HALL;
      assert.ok(confirmed>0);
      await Attendance.collection.insertOne({ _id:"attendance-test",bookingId:String(booking),eventCenter:venueId,status:"ATTENDED",updatedAt:new Date() });
      assert.ok((await profile()).profile.venues.BANQUET_HALL>confirmed);
      await Attendance.collection.updateOne({ _id:"attendance-test" },{ $set:{ status:"NO_SHOW" } });
      assert.ok((await profile()).profile.venues.BANQUET_HALL<=confirmed);
      await VenueBooking.deleteOne({ _id:booking });
      await Attendance.deleteMany({});
    });
    await t.test("HTTP endpoints protect identity and return validation status codes",async () => {
      const express=require("express"),request=require("supertest"),jwt=require("jsonwebtoken");
      process.env.ACCESS_TOKEN_SECRET="disposable-test-secret";
      const app=express();app.use(express.json());app.use("/api/discovery",require("../routes/client/discovery.route"));
      app.use((error,req,res,next)=>res.status(500).json({ message:error.message }));
      await request(app).get("/api/discovery/preferences").expect(401);
      await request(app).post("/api/discovery/events").send({}).expect(401);
      const token=jwt.sign({ accountType:"client",UserInfo:{ id:String(userId),sessionVersion:0 } },process.env.ACCESS_TOKEN_SECRET);
      await request(app).get("/api/discovery/preferences").set("Authorization","Bearer "+token).expect(200);
      await request(app).patch("/api/discovery/preferences").set("Authorization","Bearer "+token).send({ revision:pref.revision,eventTypes:["MADE_UP"] }).expect(400);
      await request(app).get("/api/discovery/home?city[x]=bad").expect(400);
    });
    await t.test("capacity includes unreleased reservations and suppresses held events",async () => {
      const hold=oid();
      await Order.collection.insertOne({ _id:hold,buyer:oid(),eventId,occurrence:0,paymentStatus:"PENDING",status:"ACTIVE",inventoryReserved:true,
        reservationExpiresAt:new Date(+now-86400000),items:[{ quantity:10 }] });
      const response=await service.home(null,{ city:"Lagos" });
      assert.equal(response.sections.flatMap(s=>s.items).some(i=>i.id===String(eventId)),false);
      await Order.deleteOne({ _id:hold });
    });
    await t.test("unlisted and archived inventory cannot be recommended; city regex is escaped",async () => {
      await Event.updateOne({ _id:eventId },{ $set:{ status:"CANCELLED" } });
      await Venue.updateOne({ _id:venueId },{ $set:{ status:"UNLISTED",archivedAt:new Date() } });
      assert.equal((await service.home(null,{ city:"Lagos" })).sections.length,0);
      assert.equal((await service.home(null,{ city:".*" })).sections.length,0);
      await Event.collection.updateOne({ _id:eventId },{ $set:{ status:"LISTED" } });
    });
    await t.test("wishlist save is trusted and rollback leaves no phantom learning",async () => {
      const express=require("express"), request=require("supertest");
      const controller=require("../controllers/client/wishlist.controller");
      const app=express(); app.use(express.json());
      app.post("/:id",(req,res,next)=>{ req.user={ id:String(userId) }; next(); },controller.toggleWishlistEvent);
      app.use((error,req,res,next)=>res.status(error.statusCode||500).json({ message:error.message }));
      await request(app).post("/"+eventId).expect(200);
      assert.equal(await Behavior.countDocuments({ type:"save",source:"server" }),1);
      assert.equal((await User.findById(userId)).wishlistEvents.length,1);
      await request(app).post("/"+eventId).expect(200);
      assert.equal((await User.findById(userId)).wishlistEvents.length,0);
      const state=await service.initialProfile(userId,await service.preferences(userId),await User.findById(userId).lean(),new Date());
      assert.equal(state.profile.samples,0);
      await request(app).post("/"+oid()).expect(404);
      assert.equal((await User.findById(userId)).wishlistEvents.length,0);
      const recordSave=service.recordSave;
      try {
        service.recordSave=async()=>{ throw Error("injected persistence failure"); };
        await request(app).post("/"+eventId).expect(500);
      } finally { service.recordSave=recordSave; }
      assert.equal((await User.findById(userId)).wishlistEvents.length,0);
      assert.equal((await Event.findById(eventId)).performance.wishlists,0);
      assert.equal(await Behavior.countDocuments({ type:"save" }),1);
    });
  } finally { await mongoose.disconnect(); if(database) await database.stop(); }
});

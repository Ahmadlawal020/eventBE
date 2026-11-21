const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const Event = require("../models/client/event.schema");
const Venue = require("../models/client/eventCenter.schema");
const TicketType = require("../models/client/eventTicketType.schema");
const User = require("../models/client/user.schema");
const Order = require("../models/client/eventBooking.schema");
const UserTicket = require("../models/client/userEventTicket.schema");
const VenueBooking = require("../models/client/eventCenterBooking.schema");
const Attendance = require("../models/client/bookingAttendance.schema");
const { Preference, Behavior, FeedRequest } = require("../models/client/discovery.schema");
const P = require("./discoveryPolicy.service");
const BASE = { status: "LISTED", "moderation.status": { $nin: ["UNLISTED", "CANCELLED"] } };
const EVENT_FIELDS = "title images location schedule eventType ageRestriction entry capacity occurrence createdBy staff coOrganisers status moderation.status createdAt";
const VENUE_FIELDS = "venueName images location venueType supportedEvents capacity basePrice weekendPrice bookingSettings archivedAt createdBy staff coOrganisers status moderation.status createdAt";
const emptyProfile = () => ({ events: {}, venues: {}, samples: 0 });
async function preferences(userId) {
  if (!userId) return { enabled: false, revision: 0, eventTypes: [], venueTypes: [] };
  let pref = await Preference.findOneAndUpdate({ userId }, { $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  if (!pref.enabled) {
    // Upgrade legacy opt-in defaults without importing activity from before activation.
    pref = await Preference.findOneAndUpdate({ userId, enabled: false },
      { $set: { enabled: true, learnedSince: new Date() }, $inc: { revision: 1 } }, { new: true }).lean()
      || await Preference.findOne({ userId }).lean();
  }
  return pref;
}
function preferenceResponse(p) {
  return { enabled: p.enabled, revision: p.revision, eventTypes: p.eventTypes || [], venueTypes: p.venueTypes || [],
    city: p.city || "", countryCode: p.countryCode || "" };
}
async function updatePreferences(userId, body, reset = false) {
  const allowed = ["enabled", "eventTypes", "venueTypes", "city", "countryCode", "revision"];
  if (!body || Object.keys(body).some(k => !allowed.includes(k)) || !Number.isSafeInteger(body.revision))
    throw P.fail("Invalid discovery preferences.");
  const values = { enabled: true };
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw P.fail("Invalid personalization setting.");
    // Accept legacy clients, but personalization is now a system default.
  }
  for (const [field, choices] of [["eventTypes", Object.keys(Event.eventLabels)], ["venueTypes", Venue.schema.path("venueType").enumValues]]) {
    if (body[field] !== undefined) {
      if (!Array.isArray(body[field]) || body[field].length > 30 || body[field].some(v => !choices.includes(v)))
        throw P.fail("Invalid interest choices.");
      values[field] = [...new Set(body[field])];
    }
  }
  for (const field of ["city", "countryCode"]) if (body[field] !== undefined) {
    if (typeof body[field] !== "string" || body[field].length > (field === "city" ? 100 : 2)) throw P.fail("Invalid location preference.");
    values[field] = body[field].trim();
  }
  if (values.countryCode) {
    values.countryCode = values.countryCode.toUpperCase();
    if (!require("../data/address/countries.json").countries[values.countryCode]) throw P.fail("Invalid country.");
  }
  // Both ingestion and reset write this document, so a late batch cannot recreate erased history.
  return mongoose.connection.transaction(async session => {
    let current = await Preference.findOne({ userId }).session(session);
    if (!current) {
      current = new Preference({ userId });
      await current.save({ session });
    }
    if (current.revision !== body.revision) throw P.fail("Preferences changed. Refresh and try again.", 409);
    const erase = reset || (values.enabled !== undefined && values.enabled !== current.enabled);
    Object.assign(current, values);
    current.revision++;
    if (erase) current.learnedSince = new Date();
    await current.save({ session });
    await FeedRequest.deleteMany({ userId }).session(session);
    // A preference revision invalidates client batches. Preserve history across ordinary interest edits.
    if (erase) await Behavior.deleteMany({ userId }).session(session);
    else await Behavior.updateMany({ userId }, { $set: { revision: current.revision } }).session(session);
    return preferenceResponse(current);
  });
}
async function ingest(userId, body) {
  const events = P.validateBatch(body), now = new Date();
  return mongoose.connection.transaction(async session => {
    const request = await FeedRequest.findOne({ requestId: body.requestId, userId, expiresAt: { $gt: now } }).session(session);
    if (!request) throw P.fail("Recommendation request expired. Refresh the feed.", 409);
    const pref = await Preference.findOneAndUpdate({ userId, enabled: true, revision: request.revision },
      { $inc: { writeVersion: 1 } }, { new: true, session });
    if (!pref) throw P.fail("Personalization is disabled or changed.", 409);
    for (const event of events) {
      const entry = request.entries.find(e => e.entityType === event.entityType && String(e.entityId) === event.entityId);
      if (!entry) throw P.fail("Interaction does not belong to this recommendation request.");
      // Deterministic keys survive mobile retries, including retry after a lost acknowledgement.
      const key = [userId, pref.revision, request.requestId, event.type, event.entityType, event.entityId].join(":");
      await Behavior.updateOne({ key }, { $setOnInsert: { key, userId, revision: pref.revision, ...event,
        occurrence: entry.occurrence || 0, requestId: request.requestId, source: "client", occurredAt: now,
        expiresAt: new Date(+now + (event.type === "impression" ? 30 : 180)*P.DAY) } }, { upsert: true, session });
    }
    return { accepted: events.length };
  });
}
// Called inside the wishlist transaction. Removed saves are filtered against current wishlist state.
async function recordSave(userId, entityType, entityId, session) {
  const pref = await Preference.findOneAndUpdate({ userId }, { $inc: { writeVersion: 1 }, $setOnInsert: { userId } }, { upsert: true, new: true, setDefaultsOnInsert: true, session });
  if (!pref?.enabled) return;
  const now = new Date(), key = [userId, pref.revision, "save", entityType, entityId, now.toISOString().slice(0,10)].join(":");
  await Behavior.updateOne({ key }, { $setOnInsert: { key, userId, revision: pref.revision, entityType, entityId,
    type: "save", source: "server", occurredAt: now, expiresAt: new Date(+now + 180*P.DAY) } }, { upsert: true, session });
}
async function initialProfile(userId, pref, user, now) {
  if (!userId || !pref.enabled) return { profile: emptyProfile() };
  const since = new Date(Math.max(+new Date(pref.learnedSince), +now - 180*P.DAY));
  const [history, orders, attended, bookings] = await Promise.all([
    Behavior.find({ userId, revision: pref.revision, occurredAt: { $gte: since }, expiresAt: { $gt: now }, type: { $nin: ["impression", "dismiss"] } })
      .sort({ occurredAt: -1, _id: -1 }).limit(300).lean(),
    Order.find({ buyer: userId, paymentStatus: "COMPLETED", status: { $in: ["ACTIVE", "COMPLETED"] },
      paymentResolutionRequired: { $ne: true }, createdAt: { $gte: since } })
      .select("eventId occurrence totalAmount createdAt").sort({ createdAt: -1 }).limit(100).lean(),
    UserTicket.find({ owner: userId, status: "REDEEMED", redeemedAt: { $gte: since } })
      .select("eventId occurrence redeemedAt").sort({ redeemedAt: -1 }).limit(100).lean(),
    VenueBooking.find({ buyer: userId, paymentStatus: "COMPLETED", status: { $in: ["ACTIVE", "CONFIRMED", "COMPLETED"] },
      paymentResolutionRequired: { $ne: true }, createdAt: { $gte: since }, "transferHistory.0": { $exists: false } })
      .select("eventCenter createdAt bookingMode status").sort({ createdAt: -1 }).limit(100).lean(),
  ]);
  const evidence = history.filter(e => e.type !== "save" ||
    (e.entityType === "Event" ? user?.wishlistEvents : user?.wishlistEventCenters)?.some(id => String(id) === String(e.entityId)));
  evidence.push(...orders.map(o => ({ entityType: "Event", entityId: o.eventId, occurrence: o.occurrence,
    type: o.totalAmount > 0 ? "purchase" : "registration", occurredAt: o.createdAt })));
  evidence.push(...attended.map(t => ({ entityType: "Event", entityId: t.eventId, occurrence: t.occurrence, type: "attendance", occurredAt: t.redeemedAt })));
  const confirmed = bookings.filter(b => b.bookingMode !== "REVIEW" || ["CONFIRMED", "COMPLETED"].includes(b.status));
  evidence.push(...confirmed.map(b => ({ entityType: "EventCenter", entityId: b.eventCenter, type: "booking", occurredAt: b.createdAt })));
  if (confirmed.length) {
    const attendance = await Attendance.find({ bookingId: { $in: confirmed.map(b => String(b._id)) }, status: "ATTENDED", updatedAt: { $gte: since } })
      .select("eventCenter updatedAt").sort({ updatedAt: -1 }).limit(100).lean();
    evidence.push(...attendance.map(a => ({ entityType: "EventCenter", entityId: a.eventCenter, type: "attendance", occurredAt: a.updatedAt })));
  }
  const ids = type => [...new Set(evidence.filter(e => e.entityType === type).map(e => String(e.entityId)))];
  const [events, venues] = await Promise.all([
    Event.find({ _id: { $in: ids("Event") } }).select("eventType createdBy staff coOrganisers").lean(),
    Venue.find({ _id: { $in: ids("EventCenter") } }).select("venueType supportedEvents createdBy staff coOrganisers").lean(),
  ]);
  const listings = new Map([...events.map(e => ["Event:"+e._id,e]), ...venues.map(e => ["EventCenter:"+e._id,e])]);
  for (const [key, value] of listings) if (P.managed(value, userId)) listings.delete(key);
  return { profile: P.affinities(evidence, listings, now) };
}
function parseContext(query, pref) {
  const context = { city: pref.city || "", countryCode: pref.countryCode || "" };
  if (!context.city && query.nearbyCity !== undefined) {
    if (typeof query.nearbyCity !== "string" || query.nearbyCity.length > 100) throw P.fail("Invalid city.");
    context.city = query.nearbyCity.trim();
    if (!context.countryCode && query.nearbyCountryCode !== undefined) {
      if (typeof query.nearbyCountryCode !== "string" || !/^[A-Z]{2}$/.test(query.nearbyCountryCode)) throw P.fail("Invalid country.");
      context.countryCode = query.nearbyCountryCode;
    }
  }
  if (query.city !== undefined) {
    if (typeof query.city !== "string" || query.city.length > 100) throw P.fail("Invalid city.");
    context.city = query.city.trim();
  }
  if (query.countryCode !== undefined) {
    if (typeof query.countryCode !== "string" || !/^[A-Z]{2}$/.test(query.countryCode)) throw P.fail("Invalid country.");
    context.countryCode = query.countryCode;
  }
  if (query.latitude !== undefined || query.longitude !== undefined) {
    const latitude = Number(query.latitude), longitude = Number(query.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) throw P.fail("Invalid coordinates.");
    if (!context.city) context.coordinates = { latitude, longitude };
  }
  return context;
}
function escapeRegex(value) { return value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"); }
async function candidates(Model, base, fields, categoryField, interests, context, sort, strictLocation = true, poolLimit = 100) {
  const local = context.city ? { "location.city": { $regex: "^"+escapeRegex(context.city)+"$", $options: "i" } } : {};
  if (context.countryCode) {
    // Legacy published listings store the country name but predate countryCode.
    // A conflicting explicit code must never be overridden by the legacy name.
    const country = require("../data/address/countries.json").countries[context.countryCode];
    const names = [...new Set([context.countryCode, country?.name, country?.displayName].filter(Boolean))];
    local.$or = [
      { "location.countryCode": context.countryCode },
      { $and: [
        { $or: [{ "location.countryCode": null }, { "location.countryCode": "" }] },
        { "location.country": { $regex: "^(?:" + names.map(escapeRegex).join("|") + ")$", $options: "i" } },
      ] },
    ];
  }
  // Automatic location boosts relevance instead of excluding all other areas.
  // Keep a local pool so nearby inventory survives the bounded global retrieval.
  const constraints = strictLocation ? local : {};
  const queries = [
    Model.find({ ...base, ...constraints }).select(fields).sort(sort).limit(poolLimit).lean(),
    ...(!strictLocation && Object.keys(local).length ? [Model.find({ ...base, ...local }).select(fields).sort(sort).limit(80).lean()] : []),
    ...(interests.length ? [Model.find({ ...base, ...constraints, [categoryField]: { $in: interests } }).select(fields).sort(sort).limit(80).lean()] : []),
  ];
  const batches = await Promise.all(queries);
  return [...new Map(batches.flat().map(item => [String(item._id), item])).values()];
}
async function capacityCounts(events) {
  const ids = events.filter(e => e.capacity != null).map(e => e._id);
  if (!ids.length) return new Map();
  const [issued, held] = await Promise.all([
    UserTicket.aggregate([{ $match: { eventId: { $in: ids }, $or: [{ status: { $in: ["UNREDEEMED","REDEEMED"] } }, { refundHold: true }] } },
      { $group: { _id: { eventId: "$eventId", occurrence: { $ifNull: ["$occurrence", 0] } }, count: { $sum: 1 } } }]),
    Order.aggregate([{ $match: { eventId: { $in: ids }, paymentStatus: "PENDING", status: "ACTIVE", inventoryReserved: true } },
      { $group: { _id: { eventId: "$eventId", occurrence: { $ifNull: ["$occurrence", 0] } }, count: { $sum: { $sum: "$items.quantity" } } } }]),
  ]);
  const counts = new Map();
  for (const row of [...issued, ...held]) {
    const key = row._id.eventId+":"+row._id.occurrence;
    counts.set(key, (counts.get(key) || 0) + row.count);
  }
  return counts;
}
async function home(userId, query = {}) {
  const now = new Date(), pref = await preferences(userId);
  const context = parseContext(query, pref);
  const strictLocation = query.city !== undefined || query.countryCode !== undefined;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 24));
  const skip = (page - 1) * limit;
  const poolLimit = Math.max(100, skip + limit + 50);
  const user = userId ? await User.findById(userId).select("dob wishlistEvents wishlistEventCenters").lean() : null;
  const { profile } = await initialProfile(userId, pref, user, now);
  const eventInterests = [...new Set([...(pref.eventTypes || []), ...Object.keys(profile.events)])];
  const venueInterests = [...new Set([...(pref.venueTypes || []), ...Object.keys(profile.venues)])];
  const [events, venues] = await Promise.all([
    candidates(Event, { ...BASE, "schedule.from": { $gt: now } }, EVENT_FIELDS, "eventType", eventInterests, context, { "schedule.from": 1, _id: 1 }, strictLocation, poolLimit),
    candidates(Venue, { ...BASE, archivedAt: null }, VENUE_FIELDS, "venueType", venueInterests, context, { createdAt: -1, _id: -1 }, strictLocation, poolLimit),
  ]);
  const [tickets, counts, owned] = await Promise.all([
    TicketType.find({ eventId: { $in: events.map(e => e._id) }, salesStartAt: { $lte: now }, salesEndAt: { $gt: now } })
      .select("eventId ticketType price donationRange currency salesStartAt salesEndAt soldQuantity totalQuantity perTransactionLimit").lean(),
    capacityCounts(events),
    userId ? UserTicket.find({ owner: userId, eventId: { $in: events.map(e => e._id) }, status: { $in: ["UNREDEEMED", "REDEEMED"] } })
      .select("eventId occurrence").lean() : [],
  ]);
  const ownedSet = new Set(owned.map(t => t.eventId+":"+(t.occurrence || 0)));
  const currencies = (process.env.PAYSTACK_SUPPORTED_CURRENCIES || "NGN").split(",").map(s => s.trim().toUpperCase());
  const eventCards = [];
  for (const event of events) {
    const key = event._id+":"+(event.occurrence || 0);
    if (!P.eventEligible(event,now) || !P.ageEligible(event,user?.dob,now) ||
      ownedSet.has(key)) continue;
    const remaining = event.capacity == null ? Infinity : event.capacity - (counts.get(key) || 0);
    if (remaining < 1) continue;
    const options = tickets.filter(t => String(t.eventId) === String(event._id) && P.sellable(t,now,currencies) &&
      remaining >= Math.max(1,t.perTransactionLimit?.min || 1));
    let admission = "ONLINE";
    if (!options.length) {
      if (!event.entry?.ticketRequired) admission = "NO_TICKET";
      else if (event.entry?.onSiteTickets) admission = "ON_SITE";
      else continue;
    }
    eventCards.push({ ...event, ...P.rank(event,"Event",profile,pref,context,now), type:"event",
      price:P.priceFor(options), admission });
  }
  const venueCards = venues.filter(v => P.publicListing(v) &&
    Number.isFinite(v.basePrice?.amount) && v.basePrice.amount > 0 &&
    ["day","hour"].includes(v.basePrice?.unit) && currencies.includes(v.basePrice.currency))
    .map(v => ({ ...v, ...P.rank(v,"EventCenter",profile,pref,context,now), type:"eventCenter",
      price:{ amount:v.basePrice.amount, currency:v.basePrice.currency, unit:v.basePrice.unit }, admission:"CHECK_AVAILABILITY" }));
  const sorted = list => list.sort((a,b) => b.score-a.score || String(a._id).localeCompare(String(b._id)));
  // One shared ranking across events and venues with pagination support.
  const rankedAll = sorted([...eventCards, ...venueCards]);
  const total = rankedAll.length;
  const pageItems = rankedAll.slice(skip, skip + limit);
  const sections = [{
    id:"for-you",
    title:pref.eventTypes?.length || pref.venueTypes?.length ? "Based on your interests" : "Recommended for you",
    items:pageItems,
  }];
  // Recheck publication after profile/inventory work; do not serialize stale moderation state.
  const selectedEvents = sections.flatMap(s => s.items).filter(i => i.type === "event");
  const selectedVenues = sections.flatMap(s => s.items).filter(i => i.type === "eventCenter");
  const [currentEvents,currentVenues] = await Promise.all([
    Event.find({ _id:{ $in:selectedEvents.map(i => i._id) }, ...BASE, "schedule.from":{ $gt:new Date() } }).select("_id").lean(),
    Venue.find({ _id:{ $in:selectedVenues.map(i => i._id) }, ...BASE, archivedAt:null }).select("_id").lean(),
  ]);
  const stillPublic = new Set([...currentEvents.map(i => "event:"+i._id),...currentVenues.map(i => "eventCenter:"+i._id)]);
  for (const section of sections) section.items = section.items.filter(i => stillPublic.has(i.type+":"+i._id));
  const requestId = randomUUID(), expiresAt = new Date(+now+30*60000);
  const entries = sections.flatMap(s => s.items.map((item,position) => ({ entityType:item.type === "event" ? "Event" : "EventCenter",
    entityId:item._id, occurrence:item.occurrence || 0, section:s.id, position })));
  // Anonymous/disabled feeds do not persist personal recommendation history.
  let trackingEnabled = false;
  if (userId && pref.enabled) trackingEnabled = await mongoose.connection.transaction(async session => {
    const current = await Preference.findOneAndUpdate({ userId, enabled:true, revision:pref.revision },
      { $inc:{ writeVersion:1 } },{ session });
    if (!current) return false;
    await FeedRequest.create([{ requestId, userId, revision:pref.revision, algorithmVersion:P.VERSION, entries, expiresAt }],{ session });
    return true;
  });
  const card = item => ({
    id:String(item._id), type:item.type, status:"LISTED", title:item.title, venueName:item.venueName,
    eventType:item.eventType, venueType:item.venueType, schedule:item.schedule,
    location:{ city:item.location?.city, country:item.location?.country, addressString:item.location?.addressString },
    images:(item.images || []).slice(0,1).map(i => ({ url:i.url })), capacity:item.capacity?.max,
    price:item.price, admission:item.admission, reason:item.reason, createdAt:item.createdAt,
  });
  return { success:true, requestId, algorithmVersion:P.VERSION, trackingEnabled,
    preferenceRevision:pref.revision, locationLabel:[context.city,context.countryCode].filter(Boolean).join(", "),
    generatedAt:now, expiresAt,
    pagination: { total, page, limit, pages: Math.ceil(total / limit), hasMore: skip + pageItems.length < total },
    sections:sections.filter(s => s.items.length).map(s => ({ ...s, items:s.items.map(card) })) };
}
module.exports = { preferences, preferenceResponse, updatePreferences, ingest, recordSave, initialProfile, parseContext, home };

const DAY = 86400000;
const VERSION = "content-v1";
const CLIENT_TYPES = new Set(["impression", "click", "engaged"]);
const SENSITIVE = new Set(["RELIGION_SPIRITUALITY", "GOVERNMENT_POLITICS", "HEALTH_WELLNESS"]);
const WEIGHTS = { impression: 0, click: 0.5, engaged: 1.5, save: 4, purchase: 6, registration: 4, attendance: 8, booking: 6 };
function fail(message, status = 400) { return Object.assign(new Error(message), { status, statusCode: status }); }
function publicListing(item) {
  return item?.status === "LISTED" && !item.archivedAt &&
    !["UNLISTED", "CANCELLED"].includes(item.moderation?.status);
}
function eventEligible(item, now = new Date()) {
  return publicListing(item) && Number.isFinite(+new Date(item.schedule?.from)) &&
    +new Date(item.schedule.from) > +now &&
    (!item.schedule.to || +new Date(item.schedule.to) >= +new Date(item.schedule.from));
}
function ageEligible(event, dob, now = new Date()) {
  const min = event.ageRestriction?.minAge, max = event.ageRestriction?.maxAge;
  if (min == null && max == null) return true;
  if (!dob || !Number.isFinite(+new Date(dob))) return false;
  const birth = new Date(dob), date = new Date(event.schedule?.from || now);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (date.getUTCMonth() < birth.getUTCMonth() ||
      (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())) age--;
  return (min == null || age >= min) && (max == null || age <= max);
}
function sellable(ticket, now = new Date(), currencies = ["NGN"]) {
  return ["PAID", "FREE", "DONATION"].includes(ticket.ticketType) &&
    +new Date(ticket.salesStartAt) <= +now && +new Date(ticket.salesEndAt) > +now &&
    ticket.totalQuantity - (ticket.soldQuantity || 0) >= Math.max(1, ticket.perTransactionLimit?.min || 1) &&
    currencies.includes(ticket.currency?.code) &&
    (ticket.ticketType === "FREE" ||
      (Number.isSafeInteger(ticket.ticketType === "DONATION" ? ticket.donationRange?.minCents : ticket.price?.amountCents) &&
       (ticket.ticketType === "DONATION" ? ticket.donationRange.minCents : ticket.price.amountCents) >= 0));
}
function priceFor(tickets) {
  if (!tickets.length) return null;
  const priced = tickets.map(t => ({ amount: (t.ticketType === "FREE" ? 0 :
    t.ticketType === "DONATION" ? t.donationRange.minCents : t.price.amountCents) / 100,
    currency: t.currency.code, symbol: t.currency.symbol, donation: t.ticketType === "DONATION" }));
  const currency = priced[0].currency;
  const comparable = priced.filter(p => p.currency === currency).sort((a,b) => a.amount - b.amount);
  return { ...comparable[0], maxAmount: Math.max(...comparable.map(p => p.amount)) };
}
function managed(item, userId) {
  return !!userId && [item.createdBy, ...(item.staff || []), ...(item.coOrganisers || [])]
    .some(id => String(id?._id || id) === String(userId));
}
function normalized(value) { return String(value || "").trim().toLocaleLowerCase("en"); }
function distanceKm(a, b) {
  if (![a?.latitude, a?.longitude, b?.latitude, b?.longitude].every(Number.isFinite)) return null;
  const rad = value => value * Math.PI / 180;
  const dlat = rad(b.latitude - a.latitude), dlon = rad(b.longitude - a.longitude);
  const h = Math.sin(dlat/2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dlon/2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
// One strongest signal per listing/occurrence/day; bot-like repetition cannot dominate.
function affinities(evidence, listings, now = new Date()) {
  const strongest = new Map();
  for (const e of evidence) {
    if (!WEIGHTS[e.type] || e.occurredAt > now) continue;
    const key = [e.entityType, e.entityId, e.occurrence || 0, new Date(e.occurredAt).toISOString().slice(0,10)].join(":");
    if (!strongest.has(key) || WEIGHTS[e.type] > WEIGHTS[strongest.get(key).type]) strongest.set(key, e);
  }
  const result = { events: {}, venues: {}, samples: 0 };
  const perItem = new Map();
  for (const e of strongest.values()) {
    const itemKey = e.entityType + ":" + e.entityId, item = listings.get(itemKey);
    if (!item) continue;
    const field = e.entityType === "Event" ? "events" : "venues";
    const category = field === "events" ? item.eventType : item.venueType;
    if (!category || (field === "events" && SENSITIVE.has(category)) || (item.supportedEvents || []).some(c => SENSITIVE.has(c))) continue;
    const age = Math.max(0, (+now - +new Date(e.occurredAt)) / DAY);
    const amount = WEIGHTS[e.type] * Math.pow(2, -age / 30);
    const accepted = Math.max(0, Math.min(amount, 8 - (perItem.get(itemKey) || 0)));
    perItem.set(itemKey, (perItem.get(itemKey) || 0) + accepted);
    result[field][category] = (result[field][category] || 0) + accepted;
    if (accepted) result.samples++;
  }
  for (const field of ["events", "venues"]) for (const key of Object.keys(result[field]))
    result[field][key] = result[field][key] / (result[field][key] + 8);
  return result;
}
function rank(item, domain, profile, preference, context, now = new Date()) {
  const category = domain === "Event" ? item.eventType : item.venueType;
  const explicit = (domain === "Event" ? preference.eventTypes : preference.venueTypes) || [];
  const affinity = explicit.includes(category) ? 1 : (profile[domain === "Event" ? "events" : "venues"][category] || 0);
  const sameCity = context.city && normalized(context.city) === normalized(item.location?.city);
  const distance = context.city ? null : distanceKm(context.coordinates, item.location?.coordinates);
  const geographic = sameCity ? 1 : distance == null ? 0.3 : Math.exp(-distance/40);
  const days = domain === "Event" ? (+new Date(item.schedule.from) - +now) / DAY : 30;
  const timing = Math.exp(-Math.max(0, days)/30);
  return { score: 0.6*affinity + 0.25*geographic + 0.15*timing,
    reason: affinity >= 0.3 ? "INTEREST" : sameCity || (distance != null && distance < 40) ? "NEARBY" : "UPCOMING" };
}
function diversify(items, limit = 24) {
  const result = [], deferred = [], organisers = new Map();
  for (const item of items) {
    const organiser = String(item.createdBy || item.id);
    if ((organisers.get(organiser) || 0) >= 2) deferred.push(item);
    else { organisers.set(organiser, (organisers.get(organiser) || 0)+1); result.push(item); }
  }
  return [...result, ...deferred].slice(0, limit);
}
function validateBatch(body) {
  if (!body || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 30)
    throw fail("Send between 1 and 30 interactions.");
  if (typeof body.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(body.requestId)) throw fail("Invalid recommendation request.");
  return body.events.map(event => {
    if (!event || !CLIENT_TYPES.has(event.type) || !["Event", "EventCenter"].includes(event.entityType) ||
      typeof event.entityId !== "string" || !/^[a-f0-9]{24}$/i.test(event.entityId)) throw fail("Invalid interaction.");
    return { type: event.type, entityType: event.entityType, entityId: event.entityId.toLowerCase() };
  });
}
module.exports = { DAY, VERSION, WEIGHTS, fail, publicListing, eventEligible, ageEligible, sellable, priceFor, managed,
  normalized, distanceKm, affinities, rank, diversify, validateBatch };

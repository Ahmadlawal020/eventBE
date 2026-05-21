const Event = require("../../models/user/event.schema");
const Ticket = require("../../models/user/eventTicket.schema");
const EventCenter = require("../../models/user/eventCenter.schema");

// 📋 Get Aggregated Listings (Events and Event Centers)
const getListings = async (req, res) => {
  try {
    const { 
      q, 
      location, 
      eventTypes, 
      venueTypes, 
      amenities, 
      minPrice, 
      maxPrice, 
      minCapacity,
      bookingType,
      listingType 
    } = req.query;

    const showEvents = !listingType || listingType === "event";
    const showCenters = !listingType || listingType === "eventCenter";

    let enrichedEvents = [];
    let enrichedEventCenters = [];

    // --- 1️⃣ Process Events ---
    if (showEvents) {
      const eventQuery = { status: { $in: ["LISTED", "PUBLISHED"] } };

      if (q) eventQuery.title = { $regex: q, $options: "i" };
      if (location) {
        eventQuery.$or = [
          { "location.addressString": { $regex: location, $options: "i" } },
          { "location.city": { $regex: location, $options: "i" } },
          { "location.country": { $regex: location, $options: "i" } },
        ];
      }
      if (eventTypes) {
        const typesArray = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
        if (typesArray.length > 0) eventQuery.eventType = { $in: typesArray };
      }
      if (minCapacity) eventQuery.capacity = { $gte: Number(minCapacity) };

      const events = await Event.find(eventQuery).lean();

      enrichedEvents = await Promise.all(
        events.map(async (event) => {
          const tickets = await Ticket.find({ eventId: event._id }).lean();
          let lowestPrice = null;
          let maxPriceVal = null;
          let currency = null;

          if (tickets.length > 0) {
            const validTickets = tickets.filter(t => t.ticketType === "PAID" || t.ticketType === "FREE");
            if (validTickets.length > 0) {
              const prices = validTickets.map(t => t.ticketType === "FREE" ? 0 : (t.price?.amountCents / 100));
              lowestPrice = Math.min(...prices);
              maxPriceVal = Math.max(...prices);
              const minTicket = validTickets.find(t => (t.ticketType === "FREE" ? 0 : (t.price?.amountCents / 100)) === lowestPrice) || validTickets[0];
              currency = {
                code: minTicket.currency?.code || "USD",
                symbol: minTicket.currency?.symbol || "$"
              };
            }
          }

          return {
            id: event._id,
            title: event.title,
            images: event.images,
            location: event.location,
            schedule: event.schedule,
            eventType: event.eventType,
            price: lowestPrice !== null ? {
              amount: lowestPrice,
              maxAmount: maxPriceVal,
              currency: currency.code,
              symbol: currency.symbol
            } : null,
            type: "event",
            createdAt: event.createdAt
          };
        })
      );

      // Filter events by price (post-enrichment)
      if (minPrice || maxPrice) {
        enrichedEvents = enrichedEvents.filter(e => {
          if (!e.price) return false;
          const min = minPrice ? Number(minPrice) : 0;
          const max = maxPrice ? Number(maxPrice) : Infinity;
          return e.price.amount >= min && e.price.amount <= max;
        });
      }
    }

    // --- 2️⃣ Process Event Centers ---
    if (showCenters) {
      const centerQuery = { status: "LISTED" };

      if (q) centerQuery.venueName = { $regex: q, $options: "i" };
      if (location) {
        centerQuery.$or = [
          { "location.addressString": { $regex: location, $options: "i" } },
          { "location.city": { $regex: location, $options: "i" } },
          { "location.country": { $regex: location, $options: "i" } },
        ];
      }
      if (venueTypes) {
        const typesArray = Array.isArray(venueTypes) ? venueTypes : [venueTypes];
        if (typesArray.length > 0) centerQuery.venueType = { $in: typesArray };
      }
      if (amenities) {
        const amenitiesArray = Array.isArray(amenities) ? amenities : [amenities];
        if (amenitiesArray.length > 0) centerQuery.amenities = { $all: amenitiesArray };
      }
      if (minPrice) centerQuery["basePrice.amount"] = { $gte: Number(minPrice) };
      if (maxPrice) centerQuery["basePrice.amount"] = { ...centerQuery["basePrice.amount"], $lte: Number(maxPrice) };
      if (minCapacity) centerQuery["capacity.max"] = { $gte: Number(minCapacity) };
      if (bookingType) centerQuery.bookingSettings = bookingType;

      const eventCenters = await EventCenter.find(centerQuery).lean();

      enrichedEventCenters = eventCenters.map((center) => {
        const prices = [];
        if (center.basePrice?.amount !== undefined) prices.push(center.basePrice.amount);
        if (center.weekendPrice?.amount !== undefined) prices.push(center.weekendPrice.amount);

        const lowestAmount = prices.length > 0 ? Math.min(...prices) : null;
        const maxAmount = prices.length > 0 ? Math.max(...prices) : null;
        const currencyCode = center.basePrice?.currency || center.weekendPrice?.currency || "USD";

        return {
          id: center._id,
          venueType: center.venueType,
          venueName: center.venueName,
          images: center.images,
          location: center.location,
          capacity: center.capacity?.max,
          price: lowestAmount !== null ? {
            amount: lowestAmount,
            maxAmount: maxAmount,
            currency: currencyCode
          } : null,
          type: "eventCenter",
          createdAt: center.createdAt
        };
      });
    }

    // --- 3️⃣ Combine and Sort ---
    const allListings = [...enrichedEvents, ...enrichedEventCenters].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({
      success: true,
      message: "Listings aggregated successfully",
      count: allListings.length,
      data: allListings,
    });
  } catch (err) {
    console.error("[GET LISTINGS] ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  getListings,
};

const Event = require("../../models/user/event.schema");
const Ticket = require("../../models/user/eventTicket.schema");
const EventCenter = require("../../models/user/eventCenter.schema");

// 📋 Get Aggregated Listings (Events and Event Centers)
const getListings = async (req, res) => {
  try {
    // 1️⃣ Fetch Published Events
    const events = await Event.find({ status: { $in: ["LISTED", "PUBLISHED"] } }).lean();

    // 2️⃣ Enrich Events with Lowest Ticket Price
    const enrichedEvents = await Promise.all(
      events.map(async (event) => {
        const tickets = await Ticket.find({ eventId: event._id }).lean();

        let lowestPrice = null;
        let maxPrice = null;
        let currency = null;

        if (tickets.length > 0) {
          // Find the lowest priced ticket (handling PAID, FREE, etc.)
          const validTickets = tickets.filter(t => t.ticketType === "PAID" || t.ticketType === "FREE");

          if (validTickets.length > 0) {
            const prices = validTickets.map(t => t.ticketType === "FREE" ? 0 : (t.price?.amountCents / 100));
            lowestPrice = Math.min(...prices);
            maxPrice = Math.max(...prices);

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
          images: event.images, // ✅ Added images
          location: event.location,
          schedule: event.schedule,
          eventType: event.eventType,
          price: lowestPrice !== null ? {
            amount: lowestPrice,
            maxAmount: maxPrice,
            currency: currency.code,
            symbol: currency.symbol
          } : null,
          type: "event",
          createdAt: event.createdAt
        };
      })
    );

    // 3️⃣ Fetch Published Event Centers
    const eventCenters = await EventCenter.find({ status: "LISTED" }).lean();

    // 4️⃣ Enrich Event Centers with Lowest Price
    const enrichedEventCenters = eventCenters.map((center) => {
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
        images: center.images, // ✅ Added images
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

    // 5️⃣ Combine and Sort by newest first
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

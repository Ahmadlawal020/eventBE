const Event = require("../../models/user/event.schema");
const Ticket = require("../../models/user/eventTicket.schema");
const EventCenter = require("../../models/user/eventCenter.schema");

// 📋 Get Aggregated Listings (Events and Event Centers)
const getListings = async (req, res) => {
  try {
    // 1️⃣ Fetch Published Events
    const events = await Event.find({ isDraft: false }).lean();
    
    // 2️⃣ Enrich Events with Lowest Ticket Price
    const enrichedEvents = await Promise.all(
      events.map(async (event) => {
        const tickets = await Ticket.find({ eventId: event._id }).lean();
        
        let lowestPrice = null;
        let currency = null;

        if (tickets.length > 0) {
          // Find the lowest priced ticket (handling PAID, FREE, etc.)
          const validTickets = tickets.filter(t => t.ticketType === "PAID" || t.ticketType === "FREE");
          
          if (validTickets.length > 0) {
            const minTicket = validTickets.reduce((min, t) => {
              const currentPrice = t.ticketType === "FREE" ? 0 : (t.price?.amountCents || 0);
              const minPrice = min.ticketType === "FREE" ? 0 : (min.price?.amountCents || Infinity);
              return currentPrice < minPrice ? t : min;
            }, validTickets[0]);

            lowestPrice = minTicket.ticketType === "FREE" ? 0 : (minTicket.price?.amountCents / 100);
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
          price: lowestPrice !== null ? {
            amount: lowestPrice,
            currency: currency.code,
            symbol: currency.symbol
          } : null,
          type: "event",
          createdAt: event.createdAt
        };
      })
    );

    // 3️⃣ Fetch Published Event Centers
    const eventCenters = await EventCenter.find({ isDraft: false }).lean();

    // 4️⃣ Enrich Event Centers with Lowest Price
    const enrichedEventCenters = eventCenters.map((center) => {
      const prices = [];
      if (center.basePrice?.amount !== undefined) prices.push(center.basePrice.amount);
      if (center.weekendPrice?.amount !== undefined) prices.push(center.weekendPrice.amount);
      
      const lowestAmount = prices.length > 0 ? Math.min(...prices) : null;
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

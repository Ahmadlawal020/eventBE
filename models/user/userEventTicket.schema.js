const { Schema, model } = require("mongoose");

const userEventTicketSchema = new Schema(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "EventBooking",
      required: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    ticketTypeId: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ticketName: { type: String, required: true }, // e.g. "Early Bird"
    ticketNumber: {
      type: String,
      unique: true,
      required: true,
    },
    // Signed QR payload for tamper-proof scanning
    qrPayload: { type: String },
    status: {
      type: String,
      enum: ["UNREDEEMED", "REDEEMED", "CANCELLED"],
      default: "UNREDEEMED",
    },
    redeemedAt: { type: Date },
    redeemedBy: { type: Schema.Types.ObjectId, ref: "User" },
    // CHECK-IN TRACKING
    checkIn: {
      isCheckedIn: { type: Boolean, default: false },
      checkedInAt: Date,
      checkedInBy: { type: Schema.Types.ObjectId, ref: "User" },
      method: {
        type: String,
        enum: ["QR", "MANUAL"],
      },
    },
    // EVENT SNAPSHOT (prevents future data inconsistency)
    eventSnapshot: {
      title: { type: String, required: true },
      shortDescription: String,
      coverImage: String,
      eventType: String,
      organiser: {
        name: String,
        email: String,
        phoneNumber: String,
      },

      location: {
        addressString: String,
        city: String,
        state: String,
        country: String,
        coordinates: {
          latitude: Number,
          longitude: Number,
        },
      },
      schedule: {
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
      },
      arrivalGuide: {
        notes: String,
        parking: String,
        checkInInstructions: String,
      },
    },

    // TICKET SNAPSHOT
    ticketSnapshot: {
      name: { type: String, required: true }, // e.g. "VIP"
      description: String,
      additionalInstruction: String,
      ticketType: {
        type: String,
        enum: ["PAID", "FREE", "DONATION"],
        required: true,
      },
      price: {
        amount: Number, // already converted from cents
        currency: String,
        symbol: String,
      },
    },

  },

  { timestamps: true }
);

// ============================================================================
// INDEXES FOR MILLION-SCALE OPERATIONS
// ============================================================================

// Primary scan lookup — used by validateTicket (sub-millisecond at any scale)
// ticketNumber already has a unique index from the schema definition

// Compound index: fast event-scoped queries (check-in stats, analytics)
userEventTicketSchema.index({ eventId: 1, status: 1 });

// Compound index: fast "my tickets for event" lookups
userEventTicketSchema.index({ owner: 1, eventId: 1 });

// Index for booking-scoped queries (find all tickets from a booking)
userEventTicketSchema.index({ bookingId: 1 });

module.exports = model("UserEventTicket", userEventTicketSchema);

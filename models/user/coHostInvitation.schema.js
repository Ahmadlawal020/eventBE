const mongoose = require("mongoose");

const coHostInvitationSchema = new mongoose.Schema(
  {
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    coHostEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    coHost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    listings: [
      {
        listingId: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
          refPath: "listings.listingType",
        },
        listingType: {
          type: String,
          required: true,
          enum: ["Event", "EventCenter"],
        },
      },
    ],
    permissions: [
      {
        type: String,
        enum: [
          "ALL_ACCESS",
          "MANAGE_LISTING",
          "MANAGE_CALENDAR",
          "MANAGE_BOOKINGS",
          "MANAGE_TICKETS",
          "VIEW_FINANCES",
          "VIEW_CALENDAR",
          "CUSTOMER_CARE",
          "MANAGE_STAFF",
          "SCAN_TICKET",
        ],
      },
    ],
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "DECLINED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CoHostInvitation", coHostInvitationSchema);

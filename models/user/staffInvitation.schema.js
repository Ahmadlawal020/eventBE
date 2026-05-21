const mongoose = require("mongoose");

const staffInvitationSchema = new mongoose.Schema(
  {
    organiser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    staffEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    staff: {
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
          "MANAGE_LISTING",
          "MANAGE_CALENDAR",
          "MANAGE_BOOKINGS",
          "MANAGE_TICKETS",
          "SCAN_TICKET",
          "CUSTOMER_CARE",
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

module.exports = mongoose.model("StaffInvitation", staffInvitationSchema);

const EventCenterTicket = require("../../models/user/eventCenterTicket.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const User = require("../../models/user/user.schema");
const mongoose = require("mongoose");
const paystackService = require("../../services/paystack.service");

// ===================== CREATE TICKET (PENDING) =====================
const createTicket = async (req, res) => {
  console.log(" [DEBUG] Create Ticket Body:", JSON.stringify(req.body, null, 2));
  const { eventCenterId, organiserId, selectedDates, bookingUnit, duration, totalPrice } = req.body;
  const buyerId = req.user.id;

  try {
    // 1. Fetch User details for automated filling
    const user = await User.findById(buyerId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const fullName = `${user.firstName} ${user.surname}`.trim();
    const phoneNumber = user.phoneNumber || "Not Provided";
    const email = user.email;

    // 2. Initialize logic based on payment method
    const reference = `MNS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { paymentMethod } = req.body;

    if (paymentMethod === 'paystack' || !paymentMethod) {
      // Initialize Paystack Transaction via Service
      const paystackData = await paystackService.initializeTransaction({
        email,
        amount: totalPrice.amount,
        reference,
        metadata: {
          eventCenterId,
          organiserId,
          buyerId,
          selectedDates,
          bookingUnit,
          duration,
          totalPrice,
          fullName,
          phoneNumber,
        },
      });

      const { authorization_url, access_code } = paystackData;

      return res.status(201).json({
        success: true,
        message: "Payment initialized successfully",
        data: {
          authorization_url,
          access_code,
          reference
        },
      });
    } else if (paymentMethod === 'transfer') {
      // Create Ticket Record immediately for manual transfer
      const newTicket = new EventCenterTicket({
        buyer: buyerId,
        organiser: organiserId,
        eventCenter: eventCenterId,
        guestDetails: {
          fullName,
          phoneNumber,
          email,
        },
        selectedDates,
        bookingUnit,
        duration,
        totalPrice,
        paystackReference: reference,
        paymentStatus: 'PENDING' // Manual verification needed
      });

      const savedTicket = await newTicket.save();

      return res.status(201).json({
        success: true,
        message: "Booking request submitted (Manual transfer)",
        data: savedTicket,
      });
    }
  } catch (err) {
    console.error(" [CREATE TICKET ERROR FULL]", err);
    res.status(500).json({
      success: false,
      message: "Server error during ticket creation",
      error: err.message,
      detail: err.response?.data || null,
      stack: process.env.NODE_ENV === 'Development' ? err.stack : undefined
    });
  }
};

// ===================== VERIFY PAYMENT & FINALIZE BOOKING =====================
const verifyPayment = async (req, res) => {
  const { reference } = req.params;

  if (!reference) {
    return res.status(400).json({ success: false, message: "Missing payment reference." });
  }

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(500).json({
      success: false,
      message: "PAYSTACK_SECRET_KEY is not set in environment variables.",
    });
  }

  try {
    // 1. Verify with Paystack Service
    const paystackData = await paystackService.verifyTransaction(reference);

    // Check if Paystack says it's successful
    if (paystackData.status !== "success") {
      return res.status(200).json({
        success: false,
        message: `Transaction is currently ${paystackData.status}.`,
        data: paystackData
      });
    }

    // 2. Check if a ticket already exists for this reference (to prevent duplicates)
    let ticket = await EventCenterTicket.findOne({ paystackReference: reference });

    if (ticket && ticket.paymentStatus === "COMPLETED") {
      return res.json({
        success: true,
        message: "Payment already verified.",
        data: ticket,
      });
    }

    // 3. Extract booking details from Paystack Metadata
    const meta = paystackData.metadata;
    const {
      eventCenterId, organiserId, buyerId,
      selectedDates, bookingUnit, duration,
      totalPrice, fullName, phoneNumber
    } = meta;

    if (!ticket) {
      // Create new Ticket record only now
      ticket = new EventCenterTicket({
        buyer: buyerId,
        organiser: organiserId,
        eventCenter: eventCenterId,
        guestDetails: {
          fullName,
          phoneNumber,
          email: paystackData.customer.email,
        },
        selectedDates,
        bookingUnit,
        duration,
        totalPrice,
        paystackReference: reference,
        paymentStatus: 'COMPLETED'
      });
    } else {
      ticket.paymentStatus = "COMPLETED";
    }

    await ticket.save();

    // 4. Update Event Center availability to prevent double-booking
    const eventCenter = await EventCenter.findById(ticket.eventCenter);
    if (eventCenter) {
      if (ticket.bookingUnit === "day") {
        // Mark whole days as unavailable
        const datesToMark = (ticket.selectedDates || []).map((d) =>
          new Date(d.date).toISOString().split("T")[0]
        );

        const currentUnavailableStrings = (
          eventCenter.availability?.unavailableDates || []
        ).map((d) => new Date(d).toISOString().split("T")[0]);

        const updatedUnavailableStrings = [
          ...new Set([...currentUnavailableStrings, ...datesToMark]),
        ];

        eventCenter.availability.unavailableDates = updatedUnavailableStrings.map(
          (d) => new Date(d)
        );
      } else if (ticket.bookingUnit === "hour") {
        // Mark specific time slots as unavailable
        const newSlots = (ticket.selectedDates || []).map((slot) => ({
          date: new Date(slot.date),
          startTime: slot.startTime,
          endTime: slot.endTime,
        }));

        if (!eventCenter.availability.unavailableSlots) {
          eventCenter.availability.unavailableSlots = [];
        }

        eventCenter.availability.unavailableSlots.push(...newSlots);
      }

      await eventCenter.save();
    }

    // 5. Notifications (Add SMS/Email logic here later)

    return res.status(200).json({
      success: true,
      message: "Payment verified and booking confirmed successfully.",
      data: ticket,
    });
  } catch (err) {
    console.error(" Payment verification error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Payment verification failed.",
      error: err.message,
    });
  }
};

const getMyTickets = async (req, res) => {
  try {
    const tickets = await EventCenterTicket.find({ buyer: req.user.id })
      .populate("eventCenter", "venueName images location")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  createTicket,
  verifyPayment,
  getMyTickets
};

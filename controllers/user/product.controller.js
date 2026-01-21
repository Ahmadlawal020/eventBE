const Ticket = require("../../models/user/product.schema");
const Event = require("../../models/user/event.schema");

/* ================================
   CREATE TICKET
================================ */
const createTicket = async (req, res) => {
  const {
    eventId,
    name,
    description,
    additionalInstruction,
    ticketType,
    totalQuantity,
    perTransactionLimit,
    requiresApproval,
    salesStartAt,
    salesEndAt,
    currency,
    commission,
    price,
    donationRange,
    groupName,
  } = req.body;

  try {
    // 🔒 Ensure event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const newTicket = new Ticket({
      eventId,
      name,
      description,
      additionalInstruction,
      ticketType,
      totalQuantity,
      perTransactionLimit,
      requiresApproval,
      salesStartAt,
      salesEndAt,
      currency,
      commission,
      price,
      donationRange,
      groupName,
    });

    const savedTicket = await newTicket.save();

    res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: savedTicket,
    });
  } catch (err) {
    console.error("[CREATE TICKET]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ================================
   GET ALL TICKETS (OPTIONAL FILTER)
================================ */
const getTickets = async (req, res) => {
  const { eventId } = req.query;

  try {
    const filter = eventId ? { eventId } : {};

    const tickets = await Ticket.find(filter).populate(
      "eventId",
      "title eventType"
    );

    res.json({
      success: true,
      message: "Tickets fetched successfully",
      data: tickets,
    });
  } catch (err) {
    console.error("[GET TICKETS]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ================================
   GET SINGLE TICKET BY ID
================================ */
const getTicketById = async (req, res) => {
  const { id } = req.params;

  try {
    const ticket = await Ticket.findById(id).populate(
      "eventId",
      "title eventType"
    );

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    res.json({
      success: true,
      message: "Ticket fetched successfully",
      data: ticket,
    });
  } catch (err) {
    console.error("[GET TICKET]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ================================
   UPDATE TICKET (PATCH)
================================ */
const updateTicket = async (req, res) => {
  const { id } = req.params;

  try {
    const prevTicket = await Ticket.findById(id);
    if (!prevTicket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const updatePayload = { ...req.body };

    // 🔐 Prevent negative inventory updates
    if (
      updatePayload.totalQuantity !== undefined &&
      updatePayload.totalQuantity < prevTicket.soldQuantity
    ) {
      return res.status(400).json({
        success: false,
        message: "Total quantity cannot be less than sold quantity",
      });
    }

    const updatedTicket = await Ticket.findByIdAndUpdate(id, updatePayload, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Ticket updated successfully",
      data: updatedTicket,
    });
  } catch (err) {
    console.error("[UPDATE TICKET]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ================================
   DELETE TICKET
================================ */
const deleteTicket = async (req, res) => {
  const { id } = req.params;

  try {
    const ticket = await Ticket.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // 🔒 Optional: block delete if sales exist
    if (ticket.soldQuantity > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a ticket with sales",
      });
    }

    await Ticket.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Ticket deleted successfully",
    });
  } catch (err) {
    console.error("[DELETE TICKET]", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  createTicket,
  getTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
};

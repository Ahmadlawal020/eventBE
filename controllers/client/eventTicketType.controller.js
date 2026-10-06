const { salesWindowError, salesEndError } = require("../../services/ticketSalesWindow.service");
const Ticket = require("../../models/client/eventTicketType.schema");
const Event = require("../../models/client/event.schema");
const CoOrganiserInvitation = require("../../models/client/coOrganiserInvitation.schema");
const {
    getEffectiveEventSettings: getEventSettings,
    getTicketMinBasePrice,
} = require("../../services/eventSettings.service");
const {
    getPlatformFees,
    normaliseTicketFeeSettings,
} = require("../../services/ticketFees.service");

const resolveTicketCommission = (
    requested,
    ticketType,
    platformFees,
    eventSettings,
) => {
    const settings = normaliseTicketFeeSettings(platformFees);
    if (ticketType === "FREE") {
        return { percentage: 0, type: "DEDUCT_FROM_PRICE" };
    }

    const feeMode =
        eventSettings?.pricing?.feeCollectionMode ||
        settings.ticketFeeMode ||
        "ORGANISER_CHOICE";

    let type = requested?.type;
    if (feeMode === "PASS_TO_BUYER") type = "ADD_ON";
    if (feeMode === "ABSORB_BY_ORGANISER") {
        type = "DEDUCT_FROM_PRICE";
    }
    if (!["ADD_ON", "DEDUCT_FROM_PRICE"].includes(type)) type = "ADD_ON";

    return {
        percentage: settings.ticketFeesEnabled ? settings.eventCommission : 0,
        type,
    };
};

const canManageEventTickets = async (event, userId) => {
    if (event.createdBy?.toString() === userId.toString()) {
        return true;
    }

    const coOrganiserInvite = await CoOrganiserInvitation.findOne({
        coOrganiser: userId,
        status: "ACCEPTED",
        "listings.listingId": event._id,
    }).lean();

    const permissions = coOrganiserInvite?.permissions || [];
    return (
        permissions.includes("MANAGE_LISTING") ||
        permissions.includes("MANAGE_TICKETS") ||
        permissions.includes("ALL_ACCESS")
    );
};

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

        const hasAccess = await canManageEventTickets(event, req.user.id);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to manage tickets for this event",
            });
        }

        const settings = await getEventSettings(event.managementLocation);
        const isFree = ticketType === "FREE";
        if (isFree && !settings.ticketing.freeEventsEnabled) {
            return res.status(400).json({
                success: false,
                message: "Free event tickets are currently disabled",
            });
        }
        if (!isFree && !settings.ticketing.paidEventsEnabled) {
            return res.status(400).json({
                success: false,
                message: "Paid and donation event tickets are currently disabled",
            });
        }

        const tierCount = await Ticket.countDocuments({ eventId });
        if (tierCount >= settings.ticketing.maxTicketTiers) {
            return res.status(400).json({
                success: false,
                message: `An event can have at most ${settings.ticketing.maxTicketTiers} ticket tiers`,
            });
        }
        if (
            Number(perTransactionLimit?.max || 0) >
            settings.ticketing.maxTicketsPerOrder
        ) {
            return res.status(400).json({
                success: false,
                message: `The ticket order limit cannot exceed ${settings.ticketing.maxTicketsPerOrder}`,
            });
        }
        if (
            !isFree &&
            settings.ticketing.requireRefundPolicyForPaidEvents &&
            !event.ticketGuide?.refundPolicy?.trim()
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "A refund policy is required before paid tickets can be created",
            });
        }
        const salesError = salesWindowError(
            event,
            salesStartAt,
            salesEndAt,
            settings.ticketing.salesCutoffMinutes
        );
        if (salesError) return res.status(400).json({ success: false, message: salesError });

        const targetCurrency = currency?.code || "NGN";
        const minRequired = getTicketMinBasePrice(settings.pricing, targetCurrency);

        if (ticketType === "PAID") {
            const amountCents = Number(price?.amountCents);
            if (!Number.isFinite(amountCents) || amountCents <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "A valid ticket price is required",
                });
            }
            if (minRequired > 0 && amountCents < Math.round(minRequired * 100)) {
                return res.status(400).json({
                    success: false,
                    message: `Ticket price for ${targetCurrency.toUpperCase()} must be at least ${minRequired}`,
                });
            }
        }

        if (ticketType === "DONATION") {
            const minCents = Number(donationRange?.minCents);
            const maxCents = Number(donationRange?.maxCents);
            if (
                !Number.isFinite(minCents) ||
                !Number.isFinite(maxCents) ||
                minCents < 0 ||
                maxCents < minCents
            ) {
                return res.status(400).json({
                    success: false,
                    message: "A valid donation range is required",
                });
            }
            if (minRequired > 0 && minCents < Math.round(minRequired * 100)) {
                return res.status(400).json({
                    success: false,
                    message: `Minimum donation for ${targetCurrency.toUpperCase()} must be at least ${minRequired}`,
                });
            }
        }

        const platformFees = await getPlatformFees();
        const newTicket = new Ticket({
            eventId,
            name,
            description,
            additionalInstruction,
            ticketType,
            totalQuantity,
            perTransactionLimit,
            salesStartAt,
            salesEndAt,
            currency,
            commission: resolveTicketCommission(
                commission,
                ticketType,
                platformFees,
                settings,
            ),
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
            "title eventType schedule",
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
            "title eventType schedule",
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

        const event = await Event.findById(prevTicket.eventId);
        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found",
            });
        }

        const hasAccess = await canManageEventTickets(event, req.user.id);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to manage tickets for this event",
            });
        }

        const updatePayload = { ...req.body };
        const settings = await getEventSettings(event.managementLocation);
        const nextTicketType = updatePayload.ticketType || prevTicket.ticketType;

        if (updatePayload.commission !== undefined || updatePayload.ticketType !== undefined) {
            const platformFees = await getPlatformFees();
            updatePayload.commission = resolveTicketCommission(
                updatePayload.commission || prevTicket.commission,
                nextTicketType,
                platformFees,
                settings,
            );
        }

        if (updatePayload.ticketType !== undefined) {
            const isFree = nextTicketType === "FREE";
            if (isFree && !settings.ticketing.freeEventsEnabled) {
                return res.status(400).json({
                    success: false,
                    message: "Free event tickets are currently disabled",
                });
            }
            if (!isFree && !settings.ticketing.paidEventsEnabled) {
                return res.status(400).json({
                    success: false,
                    message: "Paid and donation event tickets are currently disabled",
                });
            }
            if (
                !isFree &&
                settings.ticketing.requireRefundPolicyForPaidEvents &&
                !event.ticketGuide?.refundPolicy?.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message: "A refund policy is required before using paid tickets",
                });
            }
        }

        if (
            Number(updatePayload.perTransactionLimit?.max || 0) >
            settings.ticketing.maxTicketsPerOrder
        ) {
            return res.status(400).json({
                success: false,
                message: `The ticket order limit cannot exceed ${settings.ticketing.maxTicketsPerOrder}`,
            });
        }

        const nextSalesStart = updatePayload.salesStartAt !== undefined ? updatePayload.salesStartAt : prevTicket.salesStartAt;
        const nextSalesEnd = updatePayload.salesEndAt !== undefined ? updatePayload.salesEndAt : prevTicket.salesEndAt;
        const salesError = salesWindowError(event, nextSalesStart, nextSalesEnd, settings.ticketing.salesCutoffMinutes);
        if (salesError) return res.status(400).json({ success: false, message: salesError });

        const nextCurrencyCode = updatePayload.currency?.code || prevTicket.currency?.code || "NGN";
        const minRequired = getTicketMinBasePrice(settings.pricing, nextCurrencyCode);

        if (nextTicketType === "PAID") {
            const nextPrice = updatePayload.price !== undefined ? updatePayload.price : prevTicket.price;
            const amountCents = Number(nextPrice?.amountCents);
            if (updatePayload.price !== undefined || updatePayload.ticketType !== undefined || updatePayload.currency !== undefined) {
                if (!Number.isFinite(amountCents) || amountCents <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: "A valid ticket price is required",
                    });
                }
                if (minRequired > 0 && amountCents < Math.round(minRequired * 100)) {
                    return res.status(400).json({
                        success: false,
                        message: `Ticket price for ${nextCurrencyCode.toUpperCase()} must be at least ${minRequired}`,
                    });
                }
            }
        }

        if (nextTicketType === "DONATION") {
            const nextDonationRange = updatePayload.donationRange !== undefined ? updatePayload.donationRange : prevTicket.donationRange;
            const minCents = Number(nextDonationRange?.minCents);
            const maxCents = Number(nextDonationRange?.maxCents);
            if (updatePayload.donationRange !== undefined || updatePayload.ticketType !== undefined || updatePayload.currency !== undefined) {
                if (
                    !Number.isFinite(minCents) ||
                    !Number.isFinite(maxCents) ||
                    minCents < 0 ||
                    maxCents < minCents
                ) {
                    return res.status(400).json({
                        success: false,
                        message: "A valid donation range is required",
                    });
                }
                if (minRequired > 0 && minCents < Math.round(minRequired * 100)) {
                    return res.status(400).json({
                        success: false,
                        message: `Minimum donation for ${nextCurrencyCode.toUpperCase()} must be at least ${minRequired}`,
                    });
                }
            }
        }

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

        const event = await Event.findById(ticket.eventId);
        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found",
            });
        }

        const hasAccess = await canManageEventTickets(event, req.user.id);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to manage tickets for this event",
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

/* ================================
   PURCHASE TICKET (INCREMENT SOLD)
================================ */
const purchaseTicket = async (req, res) => {
    const { id } = req.params;
    const { quantity } = req.body;

    try {
        const ticket = await Ticket.findById(id);
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: "Ticket not found",
            });
        }

        // 🔒 Sold Out Check
        const available = ticket.totalQuantity - ticket.soldQuantity;
        if (available <= 0) {
            return res.status(400).json({
                success: false,
                message: "This ticket is sold out",
            });
        }

        // 🔒 Per Transaction Limit Check
        if (quantity > ticket.perTransactionLimit.max) {
            return res.status(400).json({
                success: false,
                message: `You can only purchase up to ${ticket.perTransactionLimit.max} tickets at once`,
            });
        }

        // 🔒 Inventory Check
        if (quantity > available) {
            return res.status(400).json({
                success: false,
                message: `Only ${available} tickets left`,
            });
        }

        ticket.soldQuantity += quantity;
        await ticket.save();

        res.json({
            success: true,
            message: "Ticket purchased successfully",
            data: ticket,
        });
    } catch (err) {
        console.error("[PURCHASE TICKET]", err);
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
    purchaseTicket,
};

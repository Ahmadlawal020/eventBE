const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const UserEventTicket = require("../../models/user/userEventTicket.schema");
const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const User = require("../../models/user/user.schema");
const { format } = require("date-fns");

// ============================================================================
// GENERATE TICKET PDF
// Creates a printable PDF ticket with QR code for event or venue tickets.
// Uses dynamic Y positioning to handle long text without overflow.
// ============================================================================
const generateTicketPDF = async (req, res) => {
  const userId = req.user.id;
  const { ticketId } = req.params;
  const { ticketCategory } = req.query;

  if (!ticketCategory || !["USER_EVENT", "EVENT_CENTER"].includes(ticketCategory)) {
    return res.status(400).json({
      success: false,
      message: "ticketCategory query param is required (USER_EVENT or EVENT_CENTER).",
    });
  }

  try {
    // Fetch user name from DB (not in JWT)
    const user = await User.findById(userId).select("firstName surname").lean();
    const userFullName = `${user?.firstName || ""} ${user?.surname || ""}`.trim();

    let ticket;
    let eventTitle = "";
    let ticketType = "";
    let ticketNumber = "";
    let qrPayload = "";
    let scheduleText = "";
    let locationText = "";
    let holderName = "";
    let priceText = "";

    if (ticketCategory === "USER_EVENT") {
      ticket = await UserEventTicket.findOne({ _id: ticketId, owner: userId })
        .populate("eventId", "title")
        .lean();

      if (!ticket) {
        return res.status(404).json({ success: false, message: "Ticket not found." });
      }

      eventTitle = ticket.eventSnapshot?.title || ticket.eventId?.title || "Event";
      ticketType = ticket.ticketSnapshot?.name || "Standard";
      ticketNumber = ticket.ticketNumber;
      qrPayload = ticket.qrPayload || ticket.ticketNumber;
      holderName = userFullName || "Attendee";

      if (ticket.eventSnapshot?.schedule?.startDate) {
        const start = new Date(ticket.eventSnapshot.schedule.startDate);
        scheduleText = format(start, "EEE, MMM d, yyyy 'at' h:mm aa");
      }

      const loc = ticket.eventSnapshot?.location;
      if (loc) {
        locationText = [loc.addressString, loc.city, loc.state, loc.country]
          .filter(Boolean)
          .join(", ");
      }

      if (ticket.ticketSnapshot?.price?.amount) {
        const { amount, currency, symbol } = ticket.ticketSnapshot.price;
        priceText = `${symbol || currency || ""}${amount}`;
      } else {
        priceText = ticket.ticketSnapshot?.ticketType === "FREE" ? "Free" : "";
      }
    } else {
      ticket = await EventCenterBooking.findOne({ _id: ticketId, buyer: userId })
        .populate("eventCenter", "venueName location")
        .lean();

      if (!ticket) {
        return res.status(404).json({ success: false, message: "Booking not found." });
      }

      eventTitle = ticket.eventCenter?.venueName || "Venue Booking";
      ticketType = "Venue Booking";
      ticketNumber = ticket.ticketNumber;
      qrPayload = ticket.qrPayload || ticket.ticketNumber || "";
      holderName = ticket.guestDetails?.fullName || userFullName || "Guest";

      if (ticket.selectedDates?.length) {
        const first = new Date(ticket.selectedDates[0].date);
        const last = new Date(ticket.selectedDates[ticket.selectedDates.length - 1].date);
        if (ticket.selectedDates.length === 1) {
          scheduleText = format(first, "EEE, MMM d, yyyy");
        } else {
          scheduleText = `${format(first, "MMM d")} - ${format(last, "MMM d, yyyy")}`;
        }
        if (ticket.selectedDates[0].startTime) {
          scheduleText += ` (${ticket.selectedDates[0].startTime} - ${ticket.selectedDates[0].endTime})`;
        }
      }

      const loc = ticket.eventCenter?.location;
      if (loc) {
        locationText = [loc.addressString || loc.address, loc.city, loc.state, loc.country]
          .filter(Boolean)
          .join(", ");
      }

      if (ticket.totalPrice?.amount) {
        priceText = `${ticket.totalPrice.currency || "NGN"} ${ticket.totalPrice.amount}`;
      }
    }

    if (!ticketNumber) {
      return res.status(400).json({ success: false, message: "Ticket has no ticket number." });
    }

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(qrPayload || ticketNumber, {
      width: 200,
      margin: 1,
      color: { dark: "#222222", light: "#FFFFFF" },
    });
    const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");

    // Build PDF with proper error handling
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    const pdfBuffer = await new Promise((resolve, reject) => {
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width - 100;
      const leftX = 50;
      const rightX = 300;
      const maxFieldWidth = 200;

      // Header
      doc
        .fontSize(24)
        .font("Helvetica-Bold")
        .fillColor("#222222")
        .text("Munasaba", 50, 50, { align: "center" });

      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor("#666666")
        .text("Your Entry Ticket", 50, 80, { align: "center" });

      doc.moveDown(2);

      // Event title (handles long text with wrapping)
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .fillColor("#222222")
        .text(eventTitle, 50, doc.y, {
          align: "center",
          width: pageWidth,
          lineBreak: true,
        });

      doc.moveDown(1);

      // Ticket type badge
      if (ticketType) {
        doc
          .fontSize(12)
          .font("Helvetica")
          .fillColor("#666666")
          .text(ticketType, 50, doc.y, { align: "center" });
        doc.moveDown(1.5);
      }

      // Divider
      doc
        .moveTo(50, doc.y)
        .lineTo(50 + pageWidth, doc.y)
        .strokeColor("#DDDDDD")
        .lineWidth(1)
        .stroke();
      doc.moveDown(1.5);

      // Helper: draw a label/value pair, returns the Y after drawing
      const drawDetail = (label, value, x, y, width) => {
        doc
          .fontSize(8)
          .font("Helvetica-Bold")
          .fillColor("#999999")
          .text(label.toUpperCase(), x, y, { width });
        doc
          .fontSize(12)
          .font("Helvetica")
          .fillColor("#222222")
          .text(value || "\u2014", x, y + 14, { width, lineBreak: true });
        // Return the Y position after this value text
        return doc.y;
      };

      // Row 1: Schedule | Holder
      let currentY = doc.y;
      const yAfterRow1Left = drawDetail("Schedule", scheduleText, leftX, currentY, maxFieldWidth);
      const yAfterRow1Right = drawDetail("Holder", holderName, rightX, currentY, maxFieldWidth);
      currentY = Math.max(yAfterRow1Left, yAfterRow1Right) + 12;

      // Row 2: Location | Price
      const yAfterRow2Left = drawDetail("Location", locationText, leftX, currentY, maxFieldWidth);
      const yAfterRow2Right = drawDetail("Price", priceText, rightX, currentY, maxFieldWidth);
      currentY = Math.max(yAfterRow2Left, yAfterRow2Right) + 12;

      // Row 3: Ticket Number
      currentY = drawDetail("Ticket Number", ticketNumber, leftX, currentY, maxFieldWidth) + 12;

      // Divider
      doc
        .moveTo(50, currentY + 10)
        .lineTo(50 + pageWidth, currentY + 10)
        .strokeColor("#DDDDDD")
        .lineWidth(1)
        .stroke();

      // QR Code
      const qrSize = 180;
      const qrX = (doc.page.width - qrSize) / 2;
      const qrY = currentY + 30;

      doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#999999")
        .text("SCAN FOR ENTRY", 50, qrY + qrSize + 15, {
          align: "center",
          width: pageWidth,
        });

      // Ticket number below QR
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .fillColor("#222222")
        .text(ticketNumber, 50, qrY + qrSize + 32, {
          align: "center",
          width: pageWidth,
        });

      // Footer
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#999999")
        .text("Powered by Munasaba \u2022 Verified Ticket", 50, doc.page.height - 70, {
          align: "center",
          width: pageWidth,
        });

      doc.end();
    });

    // Sanitize filename — fallback to "ticket" if title is all non-ASCII
    const safeName =
      eventTitle.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_") || "ticket";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_ticket.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("[GENERATE TICKET PDF ERROR]", error);
    res.status(500).json({ success: false, message: "Server error generating PDF." });
  }
};

module.exports = {
  generateTicketPDF,
};

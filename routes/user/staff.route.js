const express = require("express");
const router = express.Router();
const staffController = require("../../controllers/user/staff.controller");
const staffDashboardController = require("../../controllers/user/staffDashboard.controller");
const staffMessageController = require("../../controllers/user/staffMessage.controller");
const staffListingController = require("../../controllers/user/staffListing.controller");
const verifyJWT = require("../../middleware/verifyJWT");
const requireRole = require("../../middleware/requireRole");
const staffScannerController = require("../../controllers/user/staffScanner.controller");
const eventCenterBookingController = require("../../controllers/user/eventCenterBooking.controller");
const staffTicketController = require("../../controllers/user/staffTicket.controller");
const validateRequest = require("../../middleware/validateRequest");
const generateLimiter = require("../../middleware/generateLimiter");
const { sendStaffMessageSchema } = require("../../utils/validationSchemas");

const staffMessageSendLimiter = generateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many messages sent. Please slow down.",
});

router.use(verifyJWT);

// --- Invitation Management (any authenticated user) ---
router.get("/check-user", staffController.checkUserByEmail);
router.post("/invite", staffController.inviteStaff);
router.get("/my-invitations", staffController.getMyStaffInvitations);
router.get("/received-invitations", staffController.getReceivedStaffInvitations);
router.get("/invitations/:id", staffController.getStaffInvitationById);
router.patch("/respond/:id", staffController.respondToInvitation);
router.delete("/cancel/:id", staffController.cancelInvitation);
router.post("/leave/:invitationId", staffController.leaveStaff);

// --- Organiser Staff Management (requires organiser role or any user who owns listings) ---
router.get("/dashboard-stats", staffController.getStaffDashboardStats);
router.get("/all-staff", staffController.getAllStaff);
router.delete("/remove", staffController.removeStaff);
router.delete("/revoke-all/:staffId", staffController.revokeAllAccess);

// --- Dashboard & Profile Management ---
router.get("/dashboard/stats", staffDashboardController.getOrganiserStaffStats);
router.get("/profile/:staffId", staffDashboardController.getStaffDetailedProfile);
router.patch("/access/:staffId", staffDashboardController.updateStaffAccess);

// --- Staff Portal Routes (requires staff role) ---
router.get("/messages/conversations/:listingId", requireRole("staff"), staffMessageController.getStaffConversations);
router.get("/messages/:listingId/conversation/:conversationId", requireRole("staff"), staffMessageController.getStaffMessages);
router.post("/messages/send", requireRole("staff"), staffMessageSendLimiter, validateRequest(sendStaffMessageSchema), staffMessageController.sendStaffMessage);

router.get("/listing/:listingType/:listingId", requireRole("staff"), staffListingController.getStaffListing);
router.get("/listing/:listingType/:listingId/stats", requireRole("staff"), staffListingController.getStaffListingStats);

router.post("/scanner/:listingType/:listingId/verify", requireRole("staff"), staffScannerController.verifyTicketStaff);
router.post("/scanner/:listingType/:listingId/validate", requireRole("staff"), staffScannerController.validateTicketStaff);

router.get("/bookings/search/:eventCenterId", requireRole("staff"), eventCenterBookingController.searchBooking);
router.get("/bookings/stats/:eventCenterId", requireRole("staff"), eventCenterBookingController.getBookingStats);
router.get("/bookings/details/:bookingId", requireRole("staff"), eventCenterBookingController.getBookingDetails);
router.get("/bookings/:eventCenterId", requireRole("staff"), eventCenterBookingController.getEventCenterBookings);
router.post("/bookings/:bookingId/check-in", requireRole("staff"), eventCenterBookingController.manualCheckIn);
router.post("/bookings/:bookingId/cancel", requireRole("staff"), eventCenterBookingController.cancelBooking);
router.patch("/bookings/:bookingId/reschedule", requireRole("staff"), eventCenterBookingController.rescheduleBooking);

router.get("/tickets/search/:eventId", requireRole("staff"), staffTicketController.searchStaffTickets);
router.get("/tickets/stats/:eventId", requireRole("staff"), staffTicketController.getStaffTicketStats);
router.get("/tickets/tiers/:eventId", requireRole("staff"), staffTicketController.getStaffTicketTiers);
router.get("/tickets/details/:ticketId", requireRole("staff"), staffTicketController.getStaffTicketDetails);
router.get("/tickets/:eventId", requireRole("staff"), staffTicketController.getStaffEventTickets);
router.post("/tickets/:ticketId/check-in", requireRole("staff"), staffTicketController.staffTicketCheckIn);
router.post("/tickets/:ticketId/cancel", requireRole("staff"), staffTicketController.staffCancelTicket);

module.exports = router;

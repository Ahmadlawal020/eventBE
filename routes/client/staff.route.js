const express = require("express");
const router = express.Router();
const staffController = require("../../controllers/client/staff.controller");
const staffDashboardController = require("../../controllers/client/staffDashboard.controller");
const staffMessageController = require("../../controllers/client/staffMessage.controller");
const staffListingController = require("../../controllers/client/staffListing.controller");
const verifyJWT = require("../../middleware/verifyJWT");
const requireRole = require("../../middleware/requireRole");
const staffScannerController = require("../../controllers/client/staffScanner.controller");
const eventCenterBookingController = require("../../controllers/client/eventCenterBooking.controller");
const staffTicketController = require("../../controllers/client/staffTicket.controller");
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

router.get("/bookings/venue/:eventCenterId/holds", requireRole("organiser"), eventCenterBookingController.getVenueHolds);
router.post("/bookings/venue/:eventCenterId/holds", requireRole("organiser"), eventCenterBookingController.changeVenueHold);
router.patch("/bookings/venue/:eventCenterId/holds/:holdId", requireRole("organiser"), eventCenterBookingController.changeVenueHold);
router.get("/bookings/venue/:eventCenterId/today", requireRole("staff", "organiser"), eventCenterBookingController.getVenueToday);
router.get("/bookings/:bookingId/operations", requireRole("staff", "organiser"), eventCenterBookingController.getBookingOperations);
router.patch("/bookings/:bookingId/operations", requireRole("staff", "organiser"), eventCenterBookingController.updateBookingOperations);
router.get("/bookings/search/:eventCenterId", requireRole("staff", "organiser"), eventCenterBookingController.searchBooking);
router.get("/bookings/stats/:eventCenterId", requireRole("staff", "organiser"), eventCenterBookingController.getBookingStats);
router.get("/bookings/details/:bookingId", requireRole("staff", "organiser"), eventCenterBookingController.getBookingDetails);
router.get("/bookings/:eventCenterId", requireRole("staff", "organiser"), eventCenterBookingController.getEventCenterBookings);
router.get("/bookings/venue/:eventCenterId/check-ins", requireRole("staff", "organiser"), eventCenterBookingController.getVenueCheckIns);
router.get("/bookings/venue/:eventCenterId/attendance", requireRole("staff", "organiser"), eventCenterBookingController.getVenueAttendance);
router.patch("/bookings/:bookingId/attendance", requireRole("organiser"), eventCenterBookingController.updateBookingAttendance);
router.post("/bookings/:bookingId/organiser-check-in", requireRole("organiser"), eventCenterBookingController.organiserManualCheckIn);
router.post("/bookings/:bookingId/check-in", requireRole("staff", "organiser"), eventCenterBookingController.manualCheckIn);
router.get("/bookings/:bookingId/cancellation-preview", requireRole("staff", "organiser"), eventCenterBookingController.getCancellationPreview);
router.post("/bookings/:bookingId/cancel", requireRole("staff", "organiser"), eventCenterBookingController.cancelBooking);
router.patch("/bookings/:bookingId/reschedule", requireRole("staff", "organiser"), eventCenterBookingController.rescheduleBooking);

router.get("/tickets/search/:eventId", requireRole("staff"), staffTicketController.searchStaffTickets);
router.get("/tickets/stats/:eventId", requireRole("staff"), staffTicketController.getStaffTicketStats);
router.get("/tickets/tiers/:eventId", requireRole("staff"), staffTicketController.getStaffTicketTiers);
router.get("/tickets/details/:ticketId", requireRole("staff"), staffTicketController.getStaffTicketDetails);
router.get("/tickets/:eventId", requireRole("staff"), staffTicketController.getStaffEventTickets);
router.post("/tickets/:ticketId/check-in", requireRole("staff"), staffTicketController.staffTicketCheckIn);
router.post("/tickets/:ticketId/cancel", requireRole("staff"), staffTicketController.staffCancelTicket);

module.exports = router;

const express = require("express");
const router = express.Router();
const staffController = require("../../controllers/user/staff.controller");
const staffDashboardController = require("../../controllers/user/staffDashboard.controller");
const staffMessageController = require("../../controllers/user/staffMessage.controller");
const staffListingController = require("../../controllers/user/staffListing.controller");
const verifyJWT = require("../../middleware/verifyJWT");
const staffScannerController = require("../../controllers/user/staffScanner.controller");
const staffBookingController = require("../../controllers/user/staffBooking.controller");
const staffTicketController = require("../../controllers/user/staffTicket.controller");

router.use(verifyJWT);

router.get("/check-user", staffController.checkUserByEmail);
router.post("/invite", staffController.inviteStaff);
router.get("/my-invitations", staffController.getMyStaffInvitations);
router.get("/received-invitations", staffController.getReceivedStaffInvitations);
router.get("/invitations/:id", staffController.getStaffInvitationById);
router.patch("/respond/:id", staffController.respondToInvitation);
router.delete("/cancel/:id", staffController.cancelInvitation);
router.get("/dashboard-stats", staffController.getStaffDashboardStats);
router.get("/all-staff", staffController.getAllStaff);
router.post("/remove", staffController.removeStaff);
router.post("/leave/:invitationId", staffController.leaveStaff);

// --- Dashboard & Profile Management ---
router.get("/dashboard/stats", staffDashboardController.getOrganiserStaffStats);
router.get("/profile/:staffId", staffDashboardController.getStaffDetailedProfile);
router.patch("/access/:staffId", staffDashboardController.updateStaffAccess);

// --- Staff Messages ---
router.get("/messages/conversations/:listingId", staffMessageController.getStaffConversations);
router.get("/messages/:listingId/conversation/:conversationId", staffMessageController.getStaffMessages);
router.post("/messages/send", staffMessageController.sendStaffMessage);

// --- Staff Listings ---
router.get("/listing/:listingType/:listingId", staffListingController.getStaffListing);
router.get("/listing/:listingType/:listingId/stats", staffListingController.getStaffListingStats);

// --- Staff Scanner ---
router.post("/scanner/:listingType/:listingId/verify", staffScannerController.verifyTicketStaff);
router.post("/scanner/:listingType/:listingId/validate", staffScannerController.validateTicketStaff);

// --- Staff Event Center Booking Management ---
router.get("/bookings/search/:eventCenterId", staffBookingController.searchBooking);
router.get("/bookings/stats/:eventCenterId", staffBookingController.getBookingStats);
router.get("/bookings/details/:bookingId", staffBookingController.getBookingDetails);
router.get("/bookings/:eventCenterId", staffBookingController.getEventCenterBookings);
router.post("/bookings/:bookingId/check-in", staffBookingController.manualCheckIn);
router.post("/bookings/:bookingId/cancel", staffBookingController.cancelBooking);
router.patch("/bookings/:bookingId/reschedule", staffBookingController.rescheduleBooking);

// --- Staff Event Ticket Management ---
router.get("/tickets/search/:eventId", staffTicketController.searchStaffTickets);
router.get("/tickets/stats/:eventId", staffTicketController.getStaffTicketStats);
router.get("/tickets/tiers/:eventId", staffTicketController.getStaffTicketTiers);
router.get("/tickets/details/:ticketId", staffTicketController.getStaffTicketDetails);
router.get("/tickets/:eventId", staffTicketController.getStaffEventTickets);
router.post("/tickets/:ticketId/check-in", staffTicketController.staffTicketCheckIn);
router.post("/tickets/:ticketId/cancel", staffTicketController.staffCancelTicket);

module.exports = router;

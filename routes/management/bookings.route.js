const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const { requireAdminRoles } = verifyAdmin;
const {
  getBookings,
  getBookingDetail,
  updateBookingStatus,
  getVenueCalendar,
} = require("../../controllers/management/bookings.controller");

router.get("/calendar", verifyAdmin, getVenueCalendar);
router.get("/", verifyAdmin, getBookings);
router.get("/:type/:id", verifyAdmin, getBookingDetail);
router.patch(
  "/:type/:id/status",
  verifyAdmin,
  requireAdminRoles(["admin", "super_admin", "superadmin", "support_admin", "finance_admin", "finance"], "Operations or finance admin access required"),
  updateBookingStatus,
);

module.exports = router;

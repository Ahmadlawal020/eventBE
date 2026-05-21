const express = require("express");
const router = express.Router();
const verifyJWT = require("../../middleware/verifyJWT");
const {
  checkUserByEmail,
  inviteCoHost,
  getMyCoHostInvitations,
  getInvitationById,
  respondToInvitation,
  removeCoHost,
  updateCoHostPermissions,
  getReceivedInvitations,
  cancelInvitation,
} = require("../../controllers/user/coHost.controller");
const coHostDashboardController = require("../../controllers/user/coHostDashboard.controller");

// All co-host routes require authentication
router.use(verifyJWT);

/**
 * @route   GET /api/co-hosts/check-user
 * @desc    Check if a user exists by email
 * @access  Private
 */
router.get("/check-user", checkUserByEmail);

/**
 * @route   POST /api/co-hosts/invite
 * @desc    Invite a co-host to manage listings
 * @access  Private
 */
router.post("/invite", inviteCoHost);

/**
 * @route   GET /api/co-hosts/my-invitations
 * @desc    Get invitations sent by the host
 * @access  Private
 */
router.get("/my-invitations", getMyCoHostInvitations);

/**
 * @route   GET /api/co-hosts/received-invitations
 * @desc    Get invitations received by the current user
 * @access  Private
 */
router.get("/received-invitations", getReceivedInvitations);

/**
 * @route   GET /api/co-hosts/invitations/:id
 * @desc    Get a specific invitation
 * @access  Private
 */
router.get("/invitations/:id", getInvitationById);

/**
 * @route   POST /api/co-hosts/invitations/:id/respond
 * @desc    Accept or decline an invitation
 * @access  Private
 */
router.post("/invitations/:id/respond", respondToInvitation);

/**
 * @route   DELETE /api/co-hosts/invitations/:id
 * @desc    Cancel a pending invitation
 * @access  Private
 */
router.delete("/invitations/:id", cancelInvitation);

/**
 * @route   DELETE /api/co-hosts/remove
 * @desc    Remove a co-host from a listing
 * @access  Private
 */
router.delete("/remove", removeCoHost);

/**
 * @route   PATCH /api/co-hosts/permissions
 * @desc    Update permissions for an existing co-host
 * @access  Private
 */
router.patch("/permissions", updateCoHostPermissions);

// ==========================================
// 📊 DASHBOARD & PROFILE
// ==========================================
router.get("/dashboard/stats", coHostDashboardController.getOrganiserCoHostStats);
router.get("/all", coHostDashboardController.getAllCoHosts);
router.get("/profile/:coHostId", coHostDashboardController.getCoHostDetailedProfile);

module.exports = router;

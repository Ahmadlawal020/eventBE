const express = require("express");
const router = express.Router();
const verifyJWT = require("../../middleware/verifyJWT");
const {
  checkUserByEmail,
  inviteCoOrganiser,
  getMyCoOrganiserInvitations,
  getInvitationById,
  respondToInvitation,
  removeCoOrganiser,
  updateCoOrganiserPermissions,
  getReceivedInvitations,
  cancelInvitation,
} = require("../../controllers/user/coOrganiser.controller");
const coOrganiserDashboardController = require("../../controllers/user/coOrganiserDashboard.controller");

// All co-organiser routes require authentication
router.use(verifyJWT);

/**
 * @route   GET /api/co-organisers/check-user
 * @desc    Check if a user exists by email
 * @access  Private
 */
router.get("/check-user", checkUserByEmail);

/**
 * @route   POST /api/co-organisers/invite
 * @desc    Invite a co-organiser to manage listings
 * @access  Private
 */
router.post("/invite", inviteCoOrganiser);

/**
 * @route   GET /api/co-organisers/my-invitations
 * @desc    Get invitations sent by the host
 * @access  Private
 */
router.get("/my-invitations", getMyCoOrganiserInvitations);

/**
 * @route   GET /api/co-organisers/received-invitations
 * @desc    Get invitations received by the current user
 * @access  Private
 */
router.get("/received-invitations", getReceivedInvitations);

/**
 * @route   GET /api/co-organisers/invitations/:id
 * @desc    Get a specific invitation
 * @access  Private
 */
router.get("/invitations/:id", getInvitationById);

/**
 * @route   POST /api/co-organisers/invitations/:id/respond
 * @desc    Accept or decline an invitation
 * @access  Private
 */
router.post("/invitations/:id/respond", respondToInvitation);

/**
 * @route   DELETE /api/co-organisers/invitations/:id
 * @desc    Cancel a pending invitation
 * @access  Private
 */
router.delete("/invitations/:id", cancelInvitation);

/**
 * @route   DELETE /api/co-organisers/remove
 * @desc    Remove a co-organiser from a listing
 * @access  Private
 */
router.delete("/remove", removeCoOrganiser);

/**
 * @route   PATCH /api/co-organisers/permissions
 * @desc    Update permissions for an existing co-organiser
 * @access  Private
 */
router.patch("/permissions", updateCoOrganiserPermissions);

// ==========================================
// DASHBOARD & PROFILE
// ==========================================
router.get("/dashboard/stats", coOrganiserDashboardController.getOrganiserCoOrganiserStats);
router.get("/all", coOrganiserDashboardController.getAllCoOrganisers);
router.get("/profile/:coOrganiserId", coOrganiserDashboardController.getCoOrganiserDetailedProfile);

module.exports = router;

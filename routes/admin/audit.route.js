const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const { getAuditLogs } = require("../../controllers/admin/adminAudit.controller");

router.get("/", verifyAdmin, getAuditLogs);

module.exports = router;

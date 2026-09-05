const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const { getAuditLogs } = require("../../controllers/management/audit.controller");

router.get("/", verifyAdmin, getAuditLogs);

module.exports = router;

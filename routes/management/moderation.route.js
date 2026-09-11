const router = require("express").Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const verifyModerator = require("../../middleware/management/verifyModerator");
const controller = require("../../controllers/management/moderation.controller");
router.use(verifyAdmin, verifyModerator);
router.get("/", controller.getQueue);
router.get("/:type/:id", controller.getReview);
router.patch("/:type/:id", controller.decide);
module.exports = router;

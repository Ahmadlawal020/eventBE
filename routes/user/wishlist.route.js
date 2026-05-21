const express = require("express");
const wishlistController = require("../../controllers/user/wishlist.controller");
const verifyJWT = require("../../middleware/verifyJWT");

const router = express.Router();

router.use(verifyJWT); // All wishlist routes are protected

router.get("/", wishlistController.getWishlist);
router.post("/events/:id", wishlistController.toggleWishlistEvent);
router.post("/event-centers/:id", wishlistController.toggleWishlistEventCenter);

module.exports = router;

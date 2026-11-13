const router = require("express").Router();
const asyncHandler = require("express-async-handler");
const verifyJWT = require("../../middleware/verifyJWT");
const optionalJWT = require("../../middleware/optionalJWT");
const limiter = require("../../middleware/generateLimiter");
const service = require("../../services/discovery.service");
router.use(limiter({ windowMs:60000, max:120, message:"Please wait before trying discovery again." }));
router.use((req,res,next) => { res.set("Cache-Control","private, no-store"); next(); });
router.get("/home", optionalJWT, asyncHandler(async(req,res) => res.json(await service.home(req.user?.id,req.query))));
router.use(verifyJWT);
router.get("/preferences", asyncHandler(async(req,res) =>
  res.json(service.preferenceResponse(await service.preferences(req.user.id)))));
router.patch("/preferences", asyncHandler(async(req,res) =>
  res.json(await service.updatePreferences(req.user.id,req.body))));
router.delete("/history", asyncHandler(async(req,res) =>
  res.json(await service.updatePreferences(req.user.id,req.body,true))));
router.post("/events", asyncHandler(async(req,res) =>
  res.json(await service.ingest(req.user.id,req.body))));
router.use((error,req,res,next) => {
  if (error.statusCode || error.status) return res.status(error.statusCode || error.status).json({ success:false,message:error.message });
  next(error);
});
module.exports = router;

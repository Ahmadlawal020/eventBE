const { Schema, model } = require("mongoose");
module.exports = model("SignupVerification", new Schema({
  digest: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}));

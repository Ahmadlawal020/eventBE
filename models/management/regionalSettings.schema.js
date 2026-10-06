const { Schema, model } = require("mongoose");
const schema = new Schema({
  scope: { type: String, required: true, unique: true },
  overrides: { type: Schema.Types.Mixed, default: {} },
  locks: { type: [String], default: [] },
  revision: { type: Number, default: 0 },
}, { timestamps: true, minimize: false });
module.exports = model("RegionalSettings", schema);

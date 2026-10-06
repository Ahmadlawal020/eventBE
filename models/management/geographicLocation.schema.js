const { Schema, model } = require("mongoose");
const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40, unique: true },
  kind: { type: String, enum: ["continent", "country", "subdivision", "city", "district", "area"], required: true },
  parent: { type: Schema.Types.ObjectId, ref: "GeographicLocation", default: null, immutable: true },
  ancestors: [{ type: Schema.Types.ObjectId, ref: "GeographicLocation" }],
  active: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ ancestors: 1, active: 1 });
module.exports = model("GeographicLocation", schema);

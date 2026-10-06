module.exports = function geographicAssignment(schema) {
  schema.pre("save", function () {
    if (!this.isNew && this.isModified("location")) this.managementLocation = null;
  });
  schema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function () {
    const update = this.getUpdate() || {};
    const changesAddress = object => Object.keys(object || {}).some(key => key === "location" || key.startsWith("location."));
    if (changesAddress(update) || changesAddress(update.$set) || changesAddress(update.$unset)) {
      delete update.managementLocation;
      if (update.$unset) delete update.$unset.managementLocation;
      update.$set = { ...update.$set, managementLocation: null };
      this.setUpdate(update);
    }
  });
};

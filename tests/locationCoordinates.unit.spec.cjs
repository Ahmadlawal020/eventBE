const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isValidCoordinates } = require("../services/locationCoordinates");
for (const [label, modelPath, settingsPath, servicePath, method] of [
  ["event", "../models/client/event.schema", "../models/management/eventSettings.schema", "../services/eventSettings.service", "validateEventPayload"],
  ["event center", "../models/client/eventCenter.schema", "../models/management/eventCenterSettings.schema", "../services/eventCenterSettings.service", "validateVenuePayload"],
]) {
  test(label + " rejects invalid geographic coordinates in drafts and publication", () => {
    const settings = new (require(settingsPath))().toObject();
    const validate = require(servicePath)[method];
    for (const publishing of [false, true]) {
      for (const coordinates of [{ latitude: 999, longitude: 3 }, { latitude: 6, longitude: -181 }, { latitude: Infinity, longitude: 3 }, { latitude: 6 }]) {
        const errors = validate({ location: { addressString: "Test", coordinates } }, settings, { publishing });
        assert.ok(errors.some(error => /coordinates/.test(error)), JSON.stringify(coordinates));
      }
      const errors = validate({ location: { addressString: "Test", coordinates: { latitude: 0, longitude: 0 } } }, settings, { publishing });
      assert.equal(errors.some(error => /coordinates/.test(error)), false);
    }
  });
  test(label + " database schema guards coordinate bounds and accepts zero", () => {
    const Model = require(modelPath);
    const bad = new Model({ location: { coordinates: { latitude: 91, longitude: 181 } } }).validateSync();
    assert.ok(bad.errors["location.coordinates.latitude"]);
    assert.ok(bad.errors["location.coordinates.longitude"]);
    const good = new Model({ location: { coordinates: { latitude: 0, longitude: 0 } } }).validateSync();
    assert.equal(Boolean(good?.errors["location.coordinates.latitude"]), false);
    assert.equal(Boolean(good?.errors["location.coordinates.longitude"]), false);
  });
}
test("coordinate validation does not coerce strings or manufacture missing positions", () => {
  assert.equal(isValidCoordinates({ latitude: "6", longitude: 3 }), false);
  assert.equal(isValidCoordinates(null), false);
  assert.equal(isValidCoordinates({ latitude: 0, longitude: 0 }), true);
});

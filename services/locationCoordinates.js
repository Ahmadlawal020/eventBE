// Geographic validation only; event and venue publication rules stay in their own services.
function isValidCoordinates(coordinates) {
  return !!coordinates && Number.isFinite(coordinates.latitude) &&
    Math.abs(coordinates.latitude) <= 90 && Number.isFinite(coordinates.longitude) &&
    Math.abs(coordinates.longitude) <= 180;
}
module.exports = { isValidCoordinates };

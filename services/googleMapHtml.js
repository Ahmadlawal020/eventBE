const scriptValue = value => JSON.stringify(value).replace(/</g, "\\u003c");

// Hosted over HTTP(S) so Google receives a real referrer on web, Android and iOS.
function googleMapHtml({ apiKey, mapId, nonce }) {
  const scriptUrl = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(apiKey) +
    "&loading=async&libraries=marker&v=quarterly&callback=initMap";
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style nonce="${nonce}">html,body,#map{margin:0;width:100%;height:100%;overflow:hidden}</style>
</head><body><div id="map"></div>
<script nonce="${nonce}">
(function() {
  var map, markers = [], circles = [], lastRegion = "", pending, failed = false;
  function post(data) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(data));
    else window.parent.postMessage(data, "*");
  }
  function fail() { failed = true; post({type:"mapError"}); }
  window.gm_authFailure = fail;
  window.addEventListener("error", fail);
  window.addEventListener("unhandledrejection", fail);
  function valid(p) {
    return p && Number.isFinite(p.latitude) && Math.abs(p.latitude)<=90 &&
      Number.isFinite(p.longitude) && Math.abs(p.longitude)<=180;
  }
  function point(p) { return {lat:p.latitude, lng:p.longitude}; }
  function fit(region) {
    if (!valid(region)) return;
    var lat = Math.max(-85, Math.min(85, region.latitude));
    var latSpan = Math.min(170, Math.max(0.0001, region.latitudeDelta || 0.015));
    var lngSpan = Math.min(360, Math.max(0.0001, region.longitudeDelta || 0.015));
    map.fitBounds({
      south:Math.max(-85,lat-latSpan/2), north:Math.min(85,lat+latSpan/2),
      west:region.longitude-lngSpan/2, east:region.longitude+lngSpan/2
    }, 12);
  }
  window.updateMap = function(data) {
    if (!data || data.type !== "syncState") return;
    pending = data;
    if (!map || failed) return;
    try {
      var regionKey = JSON.stringify(data.region);
      if (regionKey !== lastRegion) { fit(data.region); lastRegion = regionKey; }
      markers.forEach(function(m) { m.map = null; });
      circles.forEach(function(c) { c.setMap(null); });
      markers = (data.markers || []).filter(valid).map(function(p) {
        return new google.maps.marker.AdvancedMarkerElement({map:map, position:point(p)});
      });
      circles = (data.circles || []).filter(function(c) {
        return valid(c.center) && Number.isFinite(c.radius) && c.radius>0;
      }).map(function(c) {
        return new google.maps.Circle({
          map:map, center:point(c.center), radius:c.radius,
          strokeWeight:c.strokeWidth ?? 2, strokeColor:c.strokeColor || "#0d9488",
          fillColor:c.fillColor || "#0d9488", fillOpacity:0.15, clickable:false
        });
      });
      map.setOptions({
        draggable:!!data.scrollEnabled,
        gestureHandling:data.scrollEnabled || data.zoomEnabled ? "greedy" : "none",
        scrollwheel:!!data.zoomEnabled, disableDoubleClickZoom:!data.zoomEnabled,
        zoomControl:!!data.zoomEnabled
      });
    } catch (error) { fail(); }
  };
  window.addEventListener("message", function(event) {
    if (event.source === window.parent) window.updateMap(event.data);
  });
  window.initMap = function() {
    if (failed) return;
    try {
      map = new google.maps.Map(document.getElementById("map"), {
        center:{lat:0,lng:0}, zoom:2, maxZoom:19, mapId:${scriptValue(mapId)},
        disableDefaultUI:true, keyboardShortcuts:false, clickableIcons:false,
        gestureHandling:"none", headingInteractionEnabled:false, tiltInteractionEnabled:false
      });
      map.addListener("tilesloaded", function() { if (!failed) post({type:"tilesLoaded"}); });
      map.addListener("click", function(event) {
        if (event.latLng) post({type:"mapPress", latitude:event.latLng.lat(), longitude:event.latLng.lng()});
      });
      window.addEventListener("resize", function() { lastRegion = ""; if (pending) window.updateMap(pending); });
      if (pending) window.updateMap(pending);
      post({type:"mapReady"});
    } catch (error) { fail(); }
  };
  var script = document.createElement("script");
  script.src = ${scriptValue(scriptUrl)};
  script.nonce = ${scriptValue(nonce)};
  script.async = true;
  script.onerror = fail;
  document.head.appendChild(script);
})();
</script></body></html>`;
}
module.exports = { googleMapHtml };

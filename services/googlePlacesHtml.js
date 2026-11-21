const scriptValue = value => JSON.stringify(value).replace(/</g, "\\u003c");

// Hosted on the same origin as maps so the website-restricted browser key works on native too.
function googlePlacesHtml({ apiKey, nonce }) {
  const url = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(apiKey) +
    "&loading=async&libraries=places&v=quarterly&callback=initPlaces";
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"></head><body>
<script nonce="${nonce}">
(function() {
  var session, predictions = new Map();
  function post(data) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(data));
    else window.parent.postMessage(data, "*");
  }
  window.gm_authFailure = function() { post({type:"placesError"}); };
  window.initPlaces = function() { post({type:"placesReady"}); };
  window.placesRequest = async function(request) {
    if (!request || request.type !== "placesRequest") return;
    try {
      var result;
      if (request.action === "search") {
        if (typeof request.query !== "string" || request.query.trim().length < 2) throw Error("Invalid query");
        session = session || new google.maps.places.AutocompleteSessionToken();
        var response = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input:request.query.slice(0,300), sessionToken:session,
          includedRegionCodes:request.countryCode ? [request.countryCode.toLowerCase()] : undefined,
        });
        result = response.suggestions.filter(function(s) { return s.placePrediction; }).slice(0,5).map(function(s) {
          var p = s.placePrediction;
          predictions.set(p.placeId, p);
          return {id:p.placeId, label:p.text.toString()};
        });
      } else if (request.action === "details") {
        var prediction = predictions.get(request.placeId);
        if (!prediction) throw Error("Search again");
        var place = prediction.toPlace();
        await place.fetchFields({fields:["addressComponents","formattedAddress","location"]});
        if (!place.location) throw Error("Location unavailable");
        result = {components:place.addressComponents, description:place.formattedAddress,
          latitude:place.location.lat(), longitude:place.location.lng()};
        session = undefined; predictions.clear();
      } else throw Error("Invalid action");
      post({type:"placesResult", id:request.id, result:result});
    } catch (_) { post({type:"placesResult", id:request.id, error:true}); }
  };
  window.addEventListener("message", function(event) {
    if (event.source === window.parent) window.placesRequest(event.data);
  });
  var script = document.createElement("script");
  script.src = ${scriptValue(url)}; script.nonce = ${scriptValue(nonce)};
  script.async = true; script.onerror = window.gm_authFailure;
  document.head.appendChild(script);
})();
</script></body></html>`;
}
module.exports = { googlePlacesHtml };

// Shared, provider-independent postal rules. Keep app/server copies identical.
// Metadata is refreshed by munasaba/scripts/update-address-metadata.cjs.
const bundle = require("../data/address/countries.json");
const entries = bundle.countries;
const clean = value => typeof value === "string" ? value.trim() : "";
const fold = value => clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const aliases = { uk: "GB", usa: "US", uae: "AE", ivorycoast: "CI", southkorea: "KR", northkorea: "KP", russia: "RU", czechrepublic: "CZ", turkey: "TR", swaziland: "SZ", palestine: "PS" };
const countryOptions = Object.entries(entries).map(([code, data]) => ({ code, name: data.displayName })).sort((a,b) => a.name.localeCompare(b.name, "en"));
function resolveCountryCode(value) {
  const key = clean(value).toUpperCase();
  if (entries[key]) return key;
  const name = fold(value);
  if (!name) return "";
  const display = countryOptions.find(item => fold(item.name) === name);
  if (display) return display.code;
  if (aliases[name]) return aliases[name];
  const matches = countryOptions.filter(item => fold(entries[item.code].name) === name);
  return matches.length === 1 ? matches[0].code : "";
}
function countryMetadata(value) {
  const code = resolveCountryCode(value);
  return code ? { ...bundle.defaults, ...entries[code], code } : null;
}
function subdivisions(value) {
  const data = countryMetadata(value);
  if (!data?.sub_keys) return [];
  const keys = data.sub_keys.split("~"), names = (data.sub_names || "").split("~");
  const latin = (data.sub_lnames || "").split("~"), iso = (data.sub_isoids || "").split("~");
  return keys.map((key,i) => ({ key, name: latin[i] || names[i] || key, aliases: [key,names[i],latin[i],iso[i],iso[i] ? data.code + "-" + iso[i] : ""].filter(Boolean) }));
}
function normalizeSubdivision(country, value) {
  const options = subdivisions(country), wanted = fold(value);
  if (!wanted) return "";
  let found = options.find(item => item.aliases.some(alias => fold(alias) === wanted));
  if (!found) {
    const relaxed = text => fold(clean(text).replace(/\b(state|province)\b/gi, ""));
    const matches = options.filter(item => item.aliases.some(alias => relaxed(alias) === relaxed(value)));
    if (matches.length === 1) found = matches[0];
  }
  if (!found && resolveCountryCode(country) === "NG" && ["fct","abuja","abujafct"].includes(wanted))
    found = options.find(item => item.key === "Federal Capital Territory");
  return found?.key || clean(value);
}
const labels = {
  state: "State", province: "Province", prefecture: "Prefecture", county: "County",
  island: "Island", parish: "Parish", district: "District", department: "Department",
  do_si: "Province / metropolitan city", oblast: "Region / oblast", area: "Area",
  emirate: "Emirate", city: "City / town", post_town: "Town",
  suburb: "Suburb / locality", neighborhood: "Neighbourhood", village_township: "Village / township",
};
function addressFields(value) {
  const data = countryMetadata(value);
  if (!data) return [];
  const keys = { A: "street", C: "city", S: "area", D: "locality", Z: "postcode" };
  const order = [...new Set([...(data.lfmt || data.fmt).matchAll(/%([ACDSZ])/g)].map(match => keys[match[1]]))];
  if (!order.includes("street")) order.unshift("street");
  if (data.zip && !order.includes("postcode")) order.push("postcode");
  const required = new Set((data.require || "AC").split("").map(key => keys[key]));
  required.add("street"); // These are physical event locations.
  let result = order.map(key => ({
    key, required: required.has(key),
    label: key === "street" ? "Street address" : key === "city" ? labels[data.locality_name_type] || "City / town" :
      key === "area" ? labels[data.state_name_type] || "State / province / region" :
      key === "locality" ? labels[data.sublocality_name_type] || "Locality" :
      data.code === "BR" ? "CEP" : data.zip_name_type === "zip" ? "ZIP code" : "Postcode",
  }));
  const flat = { key: "flat", label: "Flat, suite, unit", required: false };
  const at = result.findIndex(field => field.key === "street");
  if (["GB","FR","NO"].includes(data.code)) {
    const prefix = [flat];
    if (["GB","FR"].includes(data.code)) prefix.push({ key: "building", label: data.code === "GB" ? "Property name" : "Building name", required: false });
    result.splice(at, 0, ...prefix);
  } else result.splice(at+1, 0, flat);
  if (data.code === "GB") result.splice(result.findIndex(field => field.key === "city"), 0, { key: "locality", label: "Locality", required: false });
  if (data.code === "FR") result = result.map(field => field.key === "city" ? { ...field, label: "Commune" } : field);
  if (["NG","PK"].includes(data.code)) result = result.map(field => field.key === "city" ? { ...field, label: "City / town / village" } : field);
  if (data.code === "NG") result.splice(result.findIndex(field => field.key === "area"), 0, { key: "district", label: "Local government area", required: false });
  if (data.code === "BR") result = result.map(field => field.key === "city" ? { ...field, label: "City / municipality" } : field);
  return result;
}
function validateAddress(address, { requireComplete = true } = {}) {
  const value = address || {}, errors = {};
  const suppliedCode = clean(value.countryCode);
  const code = suppliedCode ? (entries[suppliedCode.toUpperCase()] ? suppliedCode.toUpperCase() : "") : resolveCountryCode(value.country);
  const data = countryMetadata(code);
  if (!data) {
    if (requireComplete || suppliedCode || clean(value.country)) errors.countryCode = "Select a country or region.";
    return errors;
  }
  const nameCode = resolveCountryCode(value.country);
  if (nameCode && nameCode !== code) errors.countryCode = "The country name and country code do not match.";
  for (const field of addressFields(code)) {
    const text = clean(value[field.key]);
    if (requireComplete && field.required && !text) errors[field.key] = field.label + " is required.";
    if (text.length > (field.key === "street" ? 512 : field.key === "postcode" ? 32 : 200)) errors[field.key] = field.label + " is too long.";
  }
  if (clean(value.area) && subdivisions(code).length) {
    const normalized = normalizeSubdivision(code, value.area);
    if (!subdivisions(code).some(item => item.key === normalized)) errors.area = "Select a valid " + (labels[data.state_name_type] || "region").toLowerCase() + ".";
  }
  if (clean(value.postcode) && data.zip && !new RegExp("^(?:" + data.zip + ")$", "i").test(clean(value.postcode)))
    errors.postcode = "Enter a valid " + (data.zip_name_type === "zip" ? "ZIP code" : "postcode") + (data.zipex ? " (for example, " + data.zipex.split(",")[0] + ")." : ".");
  return errors;
}
function formatAddress(address) {
  const code = resolveCountryCode(address.countryCode || address.country), data = countryMetadata(code);
  if (!data) return "";
  const parts = { A: [address.flat,address.building,address.street].map(clean).filter(Boolean).join(", "),
    C: clean(address.city), S: clean(address.area),
    D: [address.locality,address.district].map(clean).filter(Boolean).join(", "), Z: clean(address.postcode), N: "", O: "", X: "" };
  const lines = (data.lfmt || data.fmt).split("%n").map(line => line.replace(/%([ACDSZNOX])/g, (_,key) => parts[key]).trim().replace(/^[,\s-]+|[,\s-]+$/g,"")).filter(Boolean);
  if (!(data.lfmt || data.fmt).includes("%D") && parts.D) lines.splice(1,0,parts.D);
  if (!(data.lfmt || data.fmt).includes("%Z") && parts.Z) lines.push(parts.Z);
  return [...lines, data.displayName].join(", ");
}
module.exports = { countryOptions, resolveCountryCode, countryMetadata, subdivisions, normalizeSubdivision, addressFields, validateAddress, formatAddress };

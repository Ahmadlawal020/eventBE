const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const express = require("express");
const helmet = require("helmet");
const request = require("supertest");
const Settings = require("../models/management/platformSettings.schema");
const service = require("../services/mapSettings.service");
const { googleMapHtml } = require("../services/googleMapHtml");

function loadWith(file, overrides) {
  const filename = require.resolve(file);
  const localRequire = createRequire(filename);
  const sandbox = { module: { exports: {} }, console, process, require: id => id in overrides ? overrides[id] : localRequire(id) };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
  return sandbox.module.exports;
}
function fixture() {
  let settings = new Settings();
  const writes = [], audits = [];
  const model = {
    findOne: async () => settings,
    findOneAndUpdate: async (_filter, update, options) => {
      writes.push(options);
      settings.set(update.$set || {});
      settings.updatedAt = new Date();
      await settings.validate();
      return settings;
    },
  };
  const controller = loadWith("../controllers/management/settings.controller", {
    "../../models/management/platformSettings.schema": model,
    "../../services/management/adminAudit.service": { recordAdminAction: async audit => audits.push(audit) },
  });
  return {
    settings, writes, audits,
    async update(body) {
      const res = { code:200, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } };
      await controller.updateSettings({body}, res);
      return res;
    },
  };
}

test("legacy settings default to Leaflet and public config omits admin credentials", () => {
  assert.equal(new Settings().mapProvider, "leaflet");
  assert.deepEqual(service.publicMapConfig(null), { mapProvider:"leaflet", mapVersion:"default" });
  const config = service.publicMapConfig({ mapProvider:"google", googleMapsApiKey:"browser-key", googleMapsMapId:"map-id", supportEmail:"private" });
  assert.equal(config.mapProvider, "google");
  assert.equal(JSON.stringify(config).includes("browser-key"), false);
  assert.equal(config.supportEmail, undefined);
});

test("invalid providers, incomplete Google setup and non-string credentials cannot be saved", async () => {
  for (const body of [
    {mapProvider:"invalid"}, {mapProvider:"google"},
    {mapProvider:"google",googleMapsApiKey:"browser-key"},
    {googleMapsApiKey:null}, {googleMapsMapId:42}, {googleMapsApiKey:"<script>"},
  ]) {
    const f = fixture();
    assert.equal((await f.update(body)).code, 400);
    assert.equal(f.writes.length, 0);
    assert.equal(f.audits.length, 0);
  }
});

test("provider switches persist, preserve unrelated settings, and redact keys in audits", async () => {
  const f = fixture();
  let res = await f.update({mapProvider:"google",googleMapsApiKey:" browser-key ",googleMapsMapId:" DEMO_MAP_ID "});
  assert.equal(res.code, 200);
  assert.equal(res.body.data.mapProvider, "google");
  assert.equal(f.settings.googleMapsApiKey, "browser-key");
  assert.equal(f.settings.platformName, "Munasaba");
  assert.equal(f.writes[0].runValidators, true);
  assert.equal((await f.update({googleMapsApiKey:""})).code, 400);
  assert.equal((await f.update({maintenanceMode:true})).code, 200);
  res = await f.update({mapProvider:"leaflet"});
  assert.equal(res.body.data.mapProvider, "leaflet");
  assert.equal(f.settings.googleMapsApiKey, "browser-key");
  assert.equal(f.settings.maintenanceMode, true);
  assert.equal(JSON.stringify(f.audits.map(({previousValue, newValue}) => ({previousValue, newValue}))).includes("browser-key"), false);
  assert.equal(f.audits[0].newValue.googleMapsApiKey, "[configured]");
});

test("public routes return only config and serve an embeddable, non-cached Google page", async () => {
  let settings = null;
  const router = loadWith("../routes/client/maps.route", {
    "../../models/management/platformSettings.schema": { findOne: () => ({ lean: async () => settings }) },
  });
  const app = express();
  app.use(helmet());
  app.use("/api/maps", router);
  let response = await request(app).get("/api/maps/config");
  assert.equal(response.body.data.mapProvider, "leaflet");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal((await request(app).get("/api/maps/google")).status, 503);
  settings = {mapProvider:"google",googleMapsApiKey:"browser-key",googleMapsMapId:"DEMO_MAP_ID"};
  response = await request(app).get("/api/maps/config");
  assert.equal(response.body.data.mapProvider, "google");
  assert.equal(response.text.includes("browser-key"), false);
  response = await request(app).get("/api/maps/google");
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.equal(response.headers["x-frame-options"], undefined);
  assert.match(response.headers["content-security-policy"], /frame-ancestors 'self'/);
  assert.match(response.headers["content-security-policy"], /script-src 'nonce-/);
  assert.equal(response.headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.text, /maps.googleapis.com/);
});

test("Google bridge buffers state, fits spans, replaces overlays, handles presses and reports errors", () => {
  const html = googleMapHtml({apiKey:"browser-key",mapId:"DEMO_MAP_ID",nonce:"testnonce"});
  const posts = [], fits = [], pins = [], circles = [], listeners = {}, options = [];
  const parent = {};
  const map = {
    fitBounds: bounds => fits.push(bounds),
    setOptions: value => options.push(value),
    addListener: (name, fn) => listeners[name] = fn,
  };
  const context = {
    window: {parent, ReactNativeWebView:{postMessage:value => posts.push(JSON.parse(value))}, addEventListener:(name,fn) => listeners["window:"+name]=fn},
    document: {getElementById:() => ({}), createElement:() => ({}), head:{appendChild(){}}},
    google: {maps: {
      Map: function() { return map; },
      marker: {AdvancedMarkerElement: function(value) { Object.assign(this,value); pins.push(this); }},
      Circle: function(value) { Object.assign(this,value); this.setMap = value => this.map=value; circles.push(this); },
    }},
  };
  vm.runInNewContext(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], context);
  const state = {type:"syncState",region:{latitude:6,longitude:3,latitudeDelta:2,longitudeDelta:4},
    markers:[{latitude:0,longitude:0},{latitude:999,longitude:0}],
    circles:[{center:{latitude:6,longitude:3},radius:100}],scrollEnabled:false,zoomEnabled:false};
  context.window.updateMap(state);
  assert.equal(fits.length, 0);
  context.window.initMap();
  assert.equal(posts.at(-1).type, "mapReady");
  assert.equal(fits.length, 1);
  assert.equal(fits[0].east-fits[0].west, 4);
  assert.equal(pins.length, 1);
  assert.equal(circles.length, 1);
  assert.equal(options.at(-1).gestureHandling, "none");
  context.window.updateMap({...state,markers:[],circles:[]});
  assert.equal(fits.length, 1);
  assert.equal(pins[0].map, null);
  assert.equal(circles[0].map, null);
  listeners["window:message"]({source:{},data:{...state,region:{...state.region,longitude:8}}});
  assert.equal(fits.length, 1);
  listeners.click({latLng:{lat:()=>0,lng:()=>3}});
  assert.equal(posts.at(-1).latitude, 0);
  listeners.tilesloaded();
  assert.equal(posts.at(-1).type, "tilesLoaded");
  context.window.gm_authFailure();
  assert.equal(posts.at(-1).type, "mapError");
  listeners.tilesloaded();
  assert.equal(posts.at(-1).type, "mapError", "Auth failures must remain visible until retry");
});

test("hosted document escapes settings that could terminate a script", () => {
  const html = googleMapHtml({apiKey:"key",mapId:"</script><script>alert(1)</script>",nonce:"nonce"});
  assert.equal(html.includes("</script><script>alert"), false);
  assert.match(html, /\\u003c/);
});

test("map version changes only when map configuration changes", () => {
  const base = {mapProvider:"google",googleMapsApiKey:"browser-key",googleMapsMapId:"map-id"};
  const original = service.publicMapConfig({...base,updatedAt:new Date("2026-01-01")});
  assert.equal(service.publicMapConfig({...base,updatedAt:new Date("2026-02-01"),maintenanceMode:true}).mapVersion, original.mapVersion);
  assert.notEqual(service.publicMapConfig({...base,googleMapsApiKey:"replacement-key"}).mapVersion, original.mapVersion);
  assert.notEqual(service.publicMapConfig({...base,googleMapsMapId:"replacement-id"}).mapVersion, original.mapVersion);
});

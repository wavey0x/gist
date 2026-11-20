import assert from "node:assert/strict";
import test from "node:test";
import {
  directionsUrl,
  enrichMapBlocks,
  parseMapBlock,
  placesListHtml
} from "../public/map-block.mjs";

const yaml = `title: Santa Fe
places:
  # the base
  - name: Residence Inn
    lat: 35.65986
    lng: -105.95218
    group: Hotel
  - name: Meow Wolf
    at: 35.65465, -105.99651
    group: Activities
    label: 2
    note: Immersive art: allow 2 hours.
    link: "#meow-wolf"
  - name: "The Shed"
    coords: [35.68745, -105.93699]
    group: Food & drink
  - name: Nowhere
    group: Food & drink
`;

test("parses the YAML-style list with options, pairs and comments", () => {
  const model = parseMapBlock(yaml);
  assert.equal(model.title, "Santa Fe");
  assert.equal(model.places.length, 3);
  assert.equal(model.skipped, 1);
  const [hotel, meow, shed] = model.places;
  assert.deepEqual([hotel.lat, hotel.lng, hotel.base], [35.65986, -105.95218, true]);
  assert.deepEqual([meow.lat, meow.lng, meow.label], [35.65465, -105.99651, "2"]);
  assert.equal(meow.note, "Immersive art: allow 2 hours.");
  assert.equal(meow.link, "#meow-wolf");
  assert.deepEqual([shed.lat, shed.lng], [35.68745, -105.93699]);
  assert.deepEqual(
    model.groups.map((group) => [group.name, group.base, group.color]),
    [["Hotel", true, -1], ["Activities", false, 0], ["Food & drink", false, 1]]
  );
});

test("parses JSON arrays, place objects and GeoJSON", () => {
  assert.equal(parseMapBlock('[{"name":"A","lat":1,"lon":2}]').places[0].lng, 2);
  assert.equal(parseMapBlock('{"title":"T","pins":[{"name":"A","lat":1,"lng":2}]}').title, "T");
  const geo = parseMapBlock(
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [139.7, 35.6] }, properties: { name: "Tokyo" } }
      ]
    })
  );
  assert.deepEqual([geo.places[0].lat, geo.places[0].lng, geo.places[0].name], [35.6, 139.7, "Tokyo"]);
});

test("rejects blocks without usable coordinates and unsafe links", () => {
  assert.equal(parseMapBlock(""), null);
  assert.equal(parseMapBlock("- name: A\n  lat: 95\n  lng: 0\n"), null);
  const model = parseMapBlock('- name: A\n  lat: 1\n  lng: 2\n  link: "javascript:alert(1)"\n');
  assert.equal(model.places[0].link, "");
});

test("turns a rendered map fence into a map block and escapes content", () => {
  const source = "- name: <b>Tom & Jerry's</b>\n  lat: 1\n  lng: 2\n";
  const escaped = source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<p>x</p><pre><code class="language-map">${escaped}</code></pre>`;
  const out = enrichMapBlocks(html);
  assert.match(out, /class="map-block"/);
  assert.match(out, /data-map-state="pending"/);
  assert.ok(!out.includes("<b>"));
  assert.match(out, /&lt;b&gt;Tom &amp; Jerry&#39;s&lt;\/b&gt;/);
  // Idempotent: an enriched block is not enriched again.
  assert.equal(enrichMapBlocks(out), out);
});

test("leaves a map fence without places as a code block", () => {
  const html = '<pre><code class="language-map">just words\n</code></pre>';
  assert.equal(enrichMapBlocks(html), html);
});

test("directions open Apple Maps on Apple devices and Google Maps elsewhere", () => {
  const place = parseMapBlock("- name: Cafe Pasqual's\n  lat: 35.68659\n  lng: -105.93965\n").places[0];
  assert.equal(
    directionsUrl(place, true),
    "https://maps.apple.com/?q=Cafe%20Pasqual's&ll=35.68659,-105.93965"
  );
  assert.equal(
    directionsUrl(place, false),
    "https://www.google.com/maps/search/?api=1&query=35.68659%2C-105.93965"
  );
  assert.match(placesListHtml({ title: "", places: [place], groups: [], skipped: 0 }), /1 place</);
});

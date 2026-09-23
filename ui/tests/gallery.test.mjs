import assert from "node:assert/strict";
import test from "node:test";
import { imageAsset, parseGalleryUrl } from "../public/gallery-model.mjs";
const options = {
  baseUrl: "https://gist.example.com/article",
  imageOrigin: "https://api.example.com"
};

test("standalone previews and default/named galleries have distinct identities", () => {
  assert.deepEqual(
    parseGalleryUrl("https://example.com/photo?b=2&a=1#wg-image", options),
    {
      group: null,
      src: "https://example.com/photo?b=2&a=1",
      marker: "#wg-image"
    }
  );
  assert.equal(
    parseGalleryUrl("https://example.com/photo#wg-gallery", options).group,
    ""
  );
  assert.equal(
    parseGalleryUrl("https://example.com/photo#wg-gallery=default", options)
      .group,
    "default"
  );
  assert.equal(
    parseGalleryUrl("https://example.com/photo#wg-gallery=trip-2", options)
      .group,
    "trip-2"
  );
});
test("malformed markers and non-image schemes do not opt in", () => {
  for (const fragment of [
    "",
    "#wg-gallery=",
    "#wg-gallery=Trip",
    "#wg-gallery=a&b=2",
    "#wg-image=one",
    "#wg-gallery=a%20b"
  ])
    assert.equal(
      parseGalleryUrl("https://example.com/photo" + fragment, options),
      null
    );
  for (const source of [
    "javascript:alert(1)#wg-image",
    "data:image/png,abc#wg-image",
    "http://example.com/photo#wg-image",
    "https://user:pass@example.com/image#wg-image",
    "#wg-image",
    "/page#wg-image",
    "https://example.com/\\photo#wg-image"
  ])
    assert.equal(parseGalleryUrl(source, options), null);
});
test("only configured first-party origins are rewritten to offline image routes", () => {
  const path = "/api/v1/images/img_1234567890123456";
  assert.equal(
    imageAsset("https://external.example.com" + path, options),
    null
  );
  assert.deepEqual(
    imageAsset("https://api.example.com" + path + "?v=2#wg-image", options),
    {
      id: "img_1234567890123456",
      path: "/api/images/img_1234567890123456",
      search: "?v=2",
      hash: "#wg-image"
    }
  );
  assert.ok(
    parseGalleryUrl("/api/images/img_1234567890123456#wg-image", options)
  );
  const local = {
    baseUrl: "http://localhost:3000/gist",
    imageOrigin: "http://localhost:3001"
  };
  assert.ok(
    parseGalleryUrl("http://localhost:3001" + path + "#wg-image", local)
  );
  assert.equal(
    parseGalleryUrl("http://localhost:3001/other#wg-image", local),
    null
  );
});

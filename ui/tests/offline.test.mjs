import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workerSource = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8"
);
const shellHtml = await readFile(
  new URL("../public/offline-shell.html", import.meta.url),
  "utf8"
);
const shellScript = await readFile(
  new URL("../public/offline-shell.js", import.meta.url),
  "utf8"
);
const shellStyles = await readFile(
  new URL("../public/offline-shell.css", import.meta.url),
  "utf8"
);

function workerHarness() {
  const listeners = new Map();
  const stores = new Map();
  const addedAssets = [];

  function storeFor(name) {
    let store = stores.get(name);
    if (!store) {
      store = new Map();
      stores.set(name, store);
    }
    return store;
  }

  const caches = {
    async open(name) {
      const store = storeFor(name);
      return {
        async addAll(assets) {
          addedAssets.push(...assets);
          for (const asset of assets) {
            const url = new URL(asset, "https://gist.wavey.info").href;
            store.set(url, new Response(`cached:${asset}`));
          }
        },
        async delete(value) {
          const key = typeof value === "string" ? value : value.url;
          return store.delete(new URL(key, "https://gist.wavey.info").href);
        },
        async keys() {
          return [...store.keys()].map((url) => new Request(url));
        },
        async match(value) {
          const key = typeof value === "string" ? value : value.url;
          return store.get(new URL(key, "https://gist.wavey.info").href)?.clone();
        },
        async put(value, response) {
          const key = typeof value === "string" ? value : value.url;
          store.set(
            new URL(key, "https://gist.wavey.info").href,
            response.clone()
          );
        }
      };
    },
    async delete(name) {
      return stores.delete(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async match(value) {
      const key = typeof value === "string" ? value : value.url;
      const url = new URL(key, "https://gist.wavey.info").href;
      for (const store of stores.values()) {
        const response = store.get(url);
        if (response) {
          return response.clone();
        }
      }
      return undefined;
    }
  };

  const context = vm.createContext({
    AbortController,
    ArrayBuffer,
    Headers,
    Request,
    Response,
    Set,
    Uint8Array,
    URL,
    caches,
    fetch: async () => {
      throw new TypeError("offline");
    },
    self: {
      clients: {
        claim: async () => undefined
      },
      location: { origin: "https://gist.wavey.info" },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      }
    }
  });
  new vm.Script(workerSource, { filename: "sw.js" }).runInContext(context);
  return { addedAssets, caches, context, listeners };
}

test("the static offline shell has syntax-valid external assets", () => {
  assert.doesNotThrow(
    () => new vm.Script(shellScript, { filename: "offline-shell.js" })
  );
  assert.match(shellHtml, /href="\/github-markdown\.css\?v=3"/);
  assert.match(shellHtml, /href="\/markdown-theme\.css\?v=3"/);
  assert.match(shellHtml, /href="\/app\.css\?v=3"/);
  assert.match(shellHtml, /href="\/syntax\.css\?v=3"/);
  assert.match(shellHtml, /href="\/offline-shell\.css\?v=3"/);
  assert.match(shellHtml, /src="\/offline-shell\.js\?v=3"/);
  assert.doesNotMatch(shellHtml, /<script(?![^>]*\bsrc=)/);
});

test("online and offline readers share product styles and player markup", () => {
  assert.doesNotMatch(shellStyles, /\.article-audio-overlay\s*\{/);
  assert.doesNotMatch(shellStyles, /\.app-header\s*\{/);
  assert.doesNotMatch(shellStyles, /:root(?:\[[^\]]+\])?\s*\{/);
  assert.doesNotMatch(shellScript, /\.controls\s*=\s*true/);
  assert.match(shellScript, /className: "article-audio-overlay"/);
  assert.match(shellScript, /className\s*=\s*"article-audio-engine"/);
  assert.match(shellScript, /className: "page-header page-header-no-brand"/);
});

test("reconnection is verified and never interrupts active audio", () => {
  assert.match(shellScript, /method: "HEAD"/);
  assert.match(shellScript, /cache: "no-store"/);
  assert.match(shellScript, /if \(!audioIsPlaying\(\)\) \{\s*location\.reload\(\)/);
  assert.match(shellHtml, /class="app-offline-status offline-status"[^>]*disabled/);
});

test("install precaches the complete, version-matched shell", async () => {
  const harness = workerHarness();
  let completion;
  harness.listeners.get("install")({
    waitUntil(value) {
      completion = value;
    }
  });
  await completion;

  assert.deepEqual(harness.addedAssets, [
    "/offline-shell.html?v=3",
    "/github-markdown.css?v=3",
    "/markdown-theme.css?v=3",
    "/app.css?v=3",
    "/syntax.css?v=3",
    "/offline-shell.css?v=3",
    "/offline-shell.js?v=3",
    "/icons/icon-192.png",
    "/icons/icon-512.png"
  ]);
  assert.doesNotMatch(workerSource, /skipWaiting\s*\(/);
});

test("activation replaces only old shell caches", async () => {
  const harness = workerHarness();
  await harness.caches.open("waveygist-shell-v1");
  await harness.caches.open("waveygist-shell-v2");
  await harness.caches.open("waveygist-shell-v3");
  await harness.caches.open("waveygist-content-v1");
  await harness.caches.open("waveygist-audio-v1");

  let completion;
  harness.listeners.get("activate")({
    waitUntil(value) {
      completion = value;
    }
  });
  await completion;

  assert.deepEqual((await harness.caches.keys()).sort(), [
    "waveygist-audio-v1",
    "waveygist-content-v1",
    "waveygist-shell-v3"
  ]);
});

test("offline gist navigation falls back to the cached shell", async () => {
  const harness = workerHarness();
  let installCompletion;
  harness.listeners.get("install")({
    waitUntil(value) {
      installCompletion = value;
    }
  });
  await installCompletion;

  let responsePromise;
  harness.listeners.get("fetch")({
    request: {
      method: "GET",
      mode: "navigate",
      url: "https://gist.wavey.info/AbCdEf0123456789"
    },
    respondWith(value) {
      responsePromise = value;
    }
  });

  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "cached:/offline-shell.html?v=3");
});

test("cached audio supports normal, open, suffix, and invalid ranges", async () => {
  const harness = workerHarness();
  const audioUrl =
    "https://gist.wavey.info/api/gists/AbCdEf0123456789/revisions/1/narration/audio";
  const audioCache = await harness.caches.open("waveygist-audio-v1");
  await audioCache.put(
    audioUrl,
    new Response(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), {
      headers: { "Content-Type": "audio/mpeg", ETag: '"audio-1"' }
    })
  );

  async function cached(range, method = "GET") {
    harness.context.testRequest = {
      headers: new Headers(range ? { Range: range } : undefined),
      method,
      url: audioUrl
    };
    return vm.runInContext(
      "cachedAudioResponse(testRequest)",
      harness.context
    );
  }

  const complete = await cached(null);
  assert.equal(complete.status, 200);
  assert.equal(complete.headers.get("content-length"), "10");
  assert.deepEqual(new Uint8Array(await complete.arrayBuffer()),
    Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

  const open = await cached("bytes=4-");
  assert.equal(open.status, 206);
  assert.equal(open.headers.get("content-range"), "bytes 4-9/10");
  assert.deepEqual(new Uint8Array(await open.arrayBuffer()),
    Uint8Array.from([4, 5, 6, 7, 8, 9]));

  const suffix = await cached("bytes=-3");
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("content-range"), "bytes 7-9/10");
  assert.deepEqual(new Uint8Array(await suffix.arrayBuffer()),
    Uint8Array.from([7, 8, 9]));

  const invalid = await cached("bytes=12-20");
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), "bytes */10");

  const head = await cached("bytes=2-5", "HEAD");
  assert.equal(head.status, 206);
  assert.equal(head.headers.get("content-length"), "4");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

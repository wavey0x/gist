// One-time repair for snapshots saved with the redundant frontend table wrapper.
// The backend's labelled, focusable region is the canonical markup. Repair the
// saved payload in place so downloaded articles remain usable without a network.
const MIGRATION_KEY = "migration:table-scroll:1";

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function complete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function migrateSavedTables(database, cacheName) {
  if (await result(database.transaction("settings").objectStore("settings").get(MIGRATION_KEY))) return;
  const entries = await result(database.transaction("entries").objectStore("entries").getAll());
  const cache = await caches.open(cacheName);
  for (const entry of entries) {
    if (entry.kind !== "gist") continue;
    const response = await cache.match(entry.cacheKey);
    if (!response) continue;
    let text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { continue; }
    let changed = false;
    for (const file of Object.values(payload.files ?? {})) {
      if (file.kind !== "markdown" || !file.rendered_html?.includes("table-scroll")) continue;
      const template = document.createElement("template");
      template.innerHTML = file.rendered_html;
      const duplicates = template.content.querySelectorAll(".table-scroll > .table-scroll");
      if (!duplicates.length) continue;
      for (const wrapper of duplicates) wrapper.replaceWith(...wrapper.childNodes);
      file.rendered_html = template.innerHTML;
      changed = true;
    }
    if (changed) {
      text = JSON.stringify(payload);
      await cache.put(entry.cacheKey, new Response(text, {
        headers: { "Content-Type": "application/json" }
      }));
    }
    const byteSize = new TextEncoder().encode(text).byteLength;
    if (byteSize !== entry.byteSize) {
      const transaction = database.transaction("entries", "readwrite");
      const done = complete(transaction);
      const store = transaction.objectStore("entries");
      const current = await result(store.get(entry.key));
      if (current) store.put({ ...current, byteSize });
      await done;
    }
  }
  const transaction = database.transaction("settings", "readwrite");
  const done = complete(transaction);
  transaction.objectStore("settings").put({ key: MIGRATION_KEY, complete: true });
  await done;
}

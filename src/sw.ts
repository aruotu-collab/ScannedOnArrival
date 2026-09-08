/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(
  (self as ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> })
    .__WB_MANIFEST,
);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/share$/, /^\/api\//],
  }),
);

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share") {
    event.respondWith(handleShareTarget(event.request));
  }
});

async function handleShareTarget(request: Request): Promise<Response> {
  const formData = await request.formData();
  const entries = [...formData.getAll("files"), formData.get("file")];
  const file = entries.find((item): item is File => item instanceof File && item.size > 0);
  if (file) {
    const cache = await caches.open("soa-share");
    await cache.put(
      "/__shared_file__",
      new Response(file, {
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name || "shared-document"),
        },
      }),
    );
  }
  return Response.redirect("/?shared=1", 303);
}

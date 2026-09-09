import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "ScannedOnArrival",
        short_name: "ScannedOnArrival",
        description: "Scan letters with your phone camera in the browser. Know what documents you have, how current they are, and where they live.",
        theme_color: "#1B3A2F",
        background_color: "#F3EEE4",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        lang: "en-GB",
        categories: ["productivity", "utilities"],
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        share_target: {
          action: "/share",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            url: "url",
            files: [
              {
                name: "files",
                accept: ["application/pdf", "image/*", "application/json", ".json"],
              },
            ],
          },
        },
        file_handlers: [
          {
            action: "/",
            accept: {
              "application/pdf": [".pdf"],
              "image/jpeg": [".jpg", ".jpeg"],
              "image/png": [".png"],
              "image/webp": [".webp"],
              "application/json": [".json"],
            },
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,wasm}"],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  worker: {
    format: "es",
  },
  server: {
    proxy: {
      "/api": {
        target: "https://www.scannedonarrival.com",
        changeOrigin: true,
      },
    },
  },
});

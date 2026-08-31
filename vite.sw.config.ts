import { defineConfig } from "vite";

// The service worker is built on its own, and not as an entry of the app.
//
// Its URL is its scope, so it has to land at the root of dist/ under a
// stable, unhashed name — the opposite of what the app build does to
// every chunk. Building it rather than shipping a hand-written file in
// public/ is what lets its decisions live in a tested module
// (src/pwa/swCore.ts) instead of inside an untestable global scope.
//
// Classic script, not a module: module workers are still uneven across
// browsers, and this one has nothing to gain from being one.
export default defineConfig({
  build: {
    // The app build owns dist/ and empties it; this pass adds one file.
    emptyOutDir: false,
    lib: {
      entry: "src/pwa/sw.ts",
      formats: ["iife"],
      name: "planEditorServiceWorker",
      fileName: () => "sw.js",
    },
  },
});

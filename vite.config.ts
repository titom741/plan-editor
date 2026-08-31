import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so one build runs wherever it is dropped: at a
  // domain root, under /plan-editor/ on GitHub Pages, and behind the macOS
  // shell's planeditor://app/ scheme. A hard-coded base would tie the
  // bundle to one host and make the sub-directory case a second build.
  base: "./",
});

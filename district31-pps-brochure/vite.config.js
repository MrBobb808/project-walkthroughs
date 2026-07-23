import { defineConfig } from "vite";

// Relative base so the built site works from any sub-path
// (GitHub Pages project sites, Netlify, Vercel, Cloudflare Pages).
export default defineConfig({
  base: "./",
  build: {
    target: "es2019",
  },
});

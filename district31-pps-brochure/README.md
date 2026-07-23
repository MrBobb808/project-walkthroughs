# District 31 PPS Director — Interactive 3D Tri-Fold Brochure

A realistic, interactive digital version of the District 31 (Staten Island, New York City
Public Schools) recruitment brochure for the **Pupil Personnel Services (PPS) Director**
position. The brochure appears fully folded in 3D space and physically unfolds panel by
panel — with paper weight, flex, overshoot, dynamic shadows, and natural settling — when
you click, drag, or run the guided tour.

## Features

- **Realistic tri-fold paper model** — panels hinge on the true fold lines, carry visible
  thickness and slight misalignment while folded, flex near the crease while moving, and
  settle with spring physics (subtle overshoot, no cartoon bounce).
- **Folded-first experience** — a short intro screen, then the closed brochure in a
  three-quarter view; the camera eases to a frontal view as it opens.
- **Full interaction set** — click to open, drag/swipe the paper to scrub the fold, drag
  the background to tilt in 3D, flip to the outside spread, reset the camera, fullscreen,
  and an automated presentation tour with captions.
- **Fits every viewport** — the sheet size is recomputed from the live stage size
  (header + toolbar + safe areas accounted for), preserving the original aspect ratio, so
  the brochure never clips and the controls never overlap it.
- **Accessible** — keyboard shortcuts (Space, F, T, R, Esc), focus states, screen-reader
  labels and live status announcements, `inert` management of hidden faces, modal focus
  trapping, and `prefers-reduced-motion` support.
- **Content faithful & corrected** — the original palette, illustrations, and messaging
  are preserved; spelling/grammar errors from the print original are fixed (Qualify,
  Knowledge, Special, Experience, Systems, Agencies, Stakeholders, student outcomes, …).
  Contact details shown on the cover are **sample placeholders**, marked as such.
- **Print support** — the ⋯ menu includes a print action that lays out both spreads flat.
- **Graceful fallback** — browsers without CSS 3D transforms get flat, readable pages.

## Technology

Vanilla JavaScript + CSS 3D transforms, driven by a small custom damped-spring engine in
`app.js`. No WebGL and no runtime dependencies: DOM panels keep the text crisp, selectable,
and accessible (a texture-based Three.js approach would rasterize it), while real hinge
transforms on the fold lines plus per-hinge springs produce the sequential, physical
motion. Vite is used only as a dev server / bundler convenience — the site is fully static.

## Project structure

```
district31-pps-brochure/
├── index.html        # markup: stage, 6 panel faces, controls, intro, modal
├── styles.css        # design system, 3D structure, fold shading, print layout
├── app.js            # spring physics, fold state machine, camera, tour, modals
├── assets/           # photos recovered from the original brochure scan
├── package.json      # optional Vite dev/build scripts
└── vite.config.js    # relative base for sub-path deployments
```

## Run it

No build is required — it is a static site:

```bash
# quickest: any static file server from this directory
npx serve .
# or
python3 -m http.server 8000
```

With Vite (hot reload + minified production build):

```bash
npm install       # installs Vite (the only dependency, dev-only)
npm run dev       # development server at http://localhost:5173
npm run build     # production build in dist/
npm run preview   # preview the production build
```

## Deploy

The site is fully static (no backend). Deploy either the raw files or `dist/` after
`npm run build`.

**GitHub Pages** — from the repo settings, serve the branch (root or `/docs`) that
contains these files, or push `dist/` with an action. Because `vite.config.js` sets
`base: "./"`, the site works from any project sub-path (e.g.
`https://<user>.github.io/<repo>/district31-pps-brochure/` works without a build step).

**Netlify** — drag-and-drop the folder, or connect the repo with build command
`npm run build` and publish directory `dist` (base directory `district31-pps-brochure`).

**Vercel** — import the repo, set the root directory to `district31-pps-brochure`;
framework preset "Vite" (build `npm run build`, output `dist`), or "Other" with no build
step to serve the raw files.

**Cloudflare Pages** — same as Netlify: build `npm run build`, output `dist`.

## Controls

| Action | How |
| --- | --- |
| Open / close | Click the brochure, the **Open** button, or press **Space** |
| Scrub the fold | Drag / swipe horizontally on the paper |
| Tilt in 3D | Drag the background around the brochure |
| Inside / outside spread | **Outside** button or **F** |
| Guided tour | **Auto Tour** button or **T** |
| Reset camera | **Reset View** button or **R** |
| Fullscreen | **Fullscreen** button |
| Details | Hover/click the ⓘ hotspots on each panel |
| Print | ⋯ menu → Print brochure |

## Content note

The street address, phone number, and website on the cover panel are sample placeholder
values carried over from the original draft brochure and are labeled as such in the UI.
Replace them with official district information before publishing this for recruitment.

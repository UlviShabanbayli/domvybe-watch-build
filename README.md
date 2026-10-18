# Scroll-to-assemble watch — UI component

**[Live demo](https://domvybe.com/components/watch-build/)** · [Step-by-step tutorial](https://domvybe.com/library/watch-build/) · [Download the ZIP](https://github.com/UlviShabanbayli/domvybe-watch-build/releases/latest/download/watch-build-source.zip)

A product page where scrolling assembles a mechanical watch: 22 parts float apart and lock in one by one, the balance starts beating, and the finished watch ticks on your time.

Open `index.html` through any local static server (for example `python3 -m http.server`) and try it with a mouse,
a finger or the keyboard. Plain HTML, CSS and JavaScript; no build step; one library, three.js (vendored in vendor/three/, MIT).

- `index.html` — the product page: the build stage, the part captions, the tiles, Find a part, the bag and a no-JavaScript still
- `css` — watch.css: the page, the stage, the tiles, the phone layout, reduced motion
- `js` — app.js (scroll to assemble, the captions, the tiles, the bag), stage.js (the three.js studio and camera), watch.js + geom.js + contour.js + patches.js (the 22 parts, modelled in code), materials.js, textures.js, env.js (the finishes and the light)
- `assets` — renders/: stills of the same scene for the hero, the phone and the tiles, rendered in code
- `vendor` — three.js r186 and the addons it uses, with its MIT LICENSE

ATELIER H. and the Calibre AH-01 (the maison, the watch, its price) are made up. Everything is made in code: the 22
moving parts, the case, the finishes, the dial print and the studio light are real-time three.js renders, and
`assets/renders/` are stills of the same scene; no AI pictures. The hands show the visitor's local time. three.js (r186)
is in `vendor/three/` under its own MIT licence (`vendor/three/LICENSE`). The page reads Google Fonts (Lato, Inter).

It respects `prefers-reduced-motion`. Made by Ulvi (Code with Ulvi) · domvybe.com

## Licence

MIT — see [LICENSE](LICENSE). Use it in your own projects, commercial ones included.

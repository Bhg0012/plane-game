# Working on Sky Fling

## Shipping changes (owner's standing instruction)
After every change: commit, push the working branch, open a pull request into `main`, and merge it right away.
The owner does not want to push, pull, or merge anything by hand. `main` is what GitHub Pages serves.

## Project notes
- No build step. `index.html` loads `core.js` (classic script, also used by `tools/sim.js` in node) and `game.js` (ES module) which imports `world3d.js` and `vendor/three.module.min.js`.
- Keep it fast on phones: instanced meshes, no shadows, no per-frame allocations in hot loops.
- Run `node tools/sim.js` after changing progression or physics numbers.
- Bump `CACHE` in `sw.js` when adding files.

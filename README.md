# Sky Fling

A fast, lightweight 3D slingshot-plane distance game (inspired by the "launch, fly, upgrade, repeat" loop of mobile plane games). Three.js (bundled in `vendor/`), no build step, ~20-40 draw calls per frame so it stays smooth on phones.

## Play
Open `index.html` through any web server (it uses ES modules, so double-clicking the file won't work), or host it free on GitHub Pages:
**Settings -> Pages -> Source: Deploy from a branch -> pick the branch -> `/ (root)` -> Save.**
Then open the URL on your phone and use **Share -> Add to Home Screen** so it runs full screen like an app.

Local test: `python3 -m http.server` in this folder, then visit `http://localhost:8000`.

## How it works
- **Launch:** pull down anywhere to stretch the slingshot, slide left/right to aim, release.
- **Fly:** floating joystick - drag up/down to pitch, left/right to turn (or "Hold to climb" in settings). Keyboard: arrows/WASD, Space = launch/boost.
- **Engine** burns fuel automatically; then you glide. Dive to gain speed, climb to trade it for height.
- **Pickups:** coins (chain them for a combo of up to +200%), boost rings, fuel cans, balloons (bounce + coin burst), gems, updrafts.
- **Hazards:** trees, silos, cacti, rock pillars, towers... crash = flight over. Birds/drones just slow you down.
- **Skim bonus:** fly fast just above the ground for extra coins. Land smoothly for +10%.
- **Upgrades:** Slingshot (launch power), Plane (parts bolt on as you level: the Cardboard Plane starts as a bare body + wings, then gets a tail, cockpit & wheels, a propeller engine, fuel tanks; every 5 levels it evolves - 14 planes from Cardboard to Space Shuttle - and keeps gaining add-ons), Income (coin multiplier), Rocket booster (unlock with 1 gem, hold BOOST in flight). Press and hold a card to buy repeatedly.
- **11 zones** by distance: Meadow -> Farmland -> Desert -> Canyon -> Snow Peaks -> Metro City -> Ocean -> Volcano Isle -> Stormfront -> Stratosphere -> Orbit. Each pays more per meter and gives gems the first time you reach it.
- **Extras:** timed chest (3h), 3 free gems a day, 3 daily missions, paint jobs and trails (gems), records flag, x2 results for 3 gems.

## Saving
Progress is saved to the browser's local storage after every flight and purchase (plus a backup copy), and again when the app is closed. No account or server needed. Settings -> Backup code lets you copy your save to another device.

## Files
- `core.js` - progression math and flight physics (shared with the balance sim)
- `game.js` - game state, world generation, collisions, HUD, UI, audio, save system
- `world3d.js` - Three.js scene: plane models, instanced world objects, chase camera
- `tools/sim.js` - `node tools/sim.js` simulates hours of play to check the economy

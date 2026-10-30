# Sky Fling

**[Play Sky Fling](https://bhg0012.github.io/plane-game/)**: https://bhg0012.github.io/plane-game/

A fast, lightweight 3D slingshot-plane distance game (inspired by the "launch, fly, upgrade, repeat" loop of mobile plane games). Three.js (bundled in `vendor/`), no build step, ~20-40 draw calls per frame so it stays smooth on phones.

## Play
Open `index.html` through any web server (it uses ES modules, so double-clicking the file won't work), or host it free on GitHub Pages:
**Settings -> Pages -> Source: Deploy from a branch -> pick the branch -> `/ (root)` -> Save.**
Then open the URL on your phone and use **Share -> Add to Home Screen** so it runs full screen like an app.

Local test: `python3 -m http.server` in this folder, then visit `http://localhost:8000`.

## How it works
- **Launch:** pull down anywhere to stretch the slingshot, slide left/right to aim, release.
- **Fly:** floating joystick - pull down to climb, push up to dive (flight-stick style; flip it in Settings), left/right to bank and turn (or "Hold to climb" in settings). Keyboard: arrows/WASD follow the same setting (Down = climb by default), Space = launch/boost.
- **Engine** burns fuel automatically; then you glide. Dive to gain speed, climb to trade it for height.
- **Pickups:** coins (chain them for a combo of up to +200%), boost rings, fuel cans, fuel rings (red: engine fuel, purple: rocket fuel - fly through to refill), rare power-up rings (Shield, Magnet, Turbo, Feather, 2x Coins), balloons (bounce + coin burst), gems, updrafts.
- **Hazards:** trees, boulders, silos, wind turbines (time the spinning blades), cacti, rock arches (fly through for coins), pillars, pines, icebergs, towers, airships, ships, volcanic spires, floating mines, satellites. Some are giants that tower into cruising altitude. Hitting one or nose-diving into the ground = crash; skim past one for a NEAR MISS bonus, fly through an arch to THREAD IT. Birds/drones just slow you down.
- **Skim bonus:** fly fast just above the ground for extra coins.
- **Landing:** every part of the plane touches the ground (wheels, belly, nose, tail, wingtips). Come in level on the wheels with a gentle sink for a BUTTER (+25%) or SMOOTH (+15%) landing; hard landings bounce, belly/wingtip/tail strikes scrape, and slamming in shatters the plane into pieces.
- **Fast-forward:** after 3 seconds hands-off with the engine out, time eases up to 3x; tap 10x FINISH (or press F) to blast through the end. Touching the controls returns to normal speed.
- **Upgrades:** Slingshot (launch power), Plane (parts bolt on as you level: the Cardboard Plane starts as a bare body + wings, then gets a tail, cockpit & wheels, a propeller engine, fuel tanks; every 5 levels it evolves - 16 planes from Cardboard through a Warbird and Seaplane to tactical jets (Gunship, Twin-Tail Fighter, Swing-Wing Striker, Delta Interceptor, Stealth Fighter, Stealth Bomber, Hypersonic Spyplane) the Space Shuttle, and far-future experimentals (Forward-Swept Raptor, Plasma Arrow, Ring-Wing Skimmer, Celestial Dragonfly) - 20 planes, each gaining add-ons as it levels). The slingshot changes look every 5 levels across 8 tiers, from a twig fork to an arcane ring cannon, Income (coin multiplier), Rocket booster (unlock with 1 gem, hold BOOST in flight). Press and hold a card to buy repeatedly.
- **11 zones** by distance: Meadow -> Farmland -> Desert -> Canyon -> Snow Peaks -> Metro City -> Ocean -> Volcano Isle -> Stormfront -> Stratosphere -> Orbit. Each pays more per meter and gives gems the first time you reach it.
- **Swoops:** dive and level out to turn the height you lost into a speed burst (bigger the further you dropped, double if you pull out low).
- **Juice:** slow-motion on near misses / arch threads / sonic booms, SONIC BOOM bonus when you break a speed barrier, GOLD RUSH at a x25 combo (double coins + coin magnet + gold trail for 6s), ring chains with a PERFECT CHAIN bonus, and a see-through ghost replaying your best run.
- **Progression:** Pilot Rank (XP from every flight, rewards on each rank-up), 19 trophies with gem rewards, plane stat bars in the Hangar.
- **Damage:** a wingtip clip snaps that wing off - you keep flying, but with less lift and a pull toward the broken side.
- **Customise:** 12 paints, 6 trails, 6 decals (racing stripes, shark teeth, flames, stars, lightning bolt, checkered tail).
- **Extras:** 7-day login streak, timed chest (3h), 3 free gems a day, 3 daily missions, paint jobs and trails (gems), records flag, x2 results for 3 gems.

## Saving
Progress is saved to the browser's local storage after every flight and purchase (plus a backup copy), and again when the app is closed.

**Cross-device sync (Supabase):** Settings -> Cloud save -> *Get my code* gives a 6-character code; enter it on another device (or on the welcome screen of a fresh install) to share the same progress. Each device pushes changes a few seconds after they happen and pulls the newest save when the game opens or comes back to the foreground. Setup lives in `supabase.sql` (run once in the Supabase SQL editor) and `sync-config.js` (project URL + publishable key). The table is locked; the game can only read/write one save by its code.

## Files
- `core.js` - progression math and flight physics (shared with the balance sim)
- `game.js` - game state, world generation, collisions, HUD, UI, audio, save system
- `world3d.js` - Three.js scene: plane models, instanced world objects, chase camera
- `tools/sim.js` - `node tools/sim.js` simulates hours of play to check the economy

# Third-party notices

Libraries installed through npm keep their own licenses. Two of them are inlined into the built page.

| Component | Used for | License |
|---|---|---|
| [PixiJS](https://github.com/pixijs/pixijs) 7.4 (`pixi.js`) | the arena, the UI Spine, the browser's video (inlined into the page) | MIT |
| [pixi-spine](https://github.com/pixijs/spine) 4.0 (`pixi-spine`) | Spine 3.8 skeletons (inlined into the page) | MIT; contains the Spine Runtimes, under the [Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license) — see NOTICE.md §1 for the additional permission |
| [ws](https://github.com/websockets/ws) 8 | the gateway's lobby and the instances' match sockets | MIT |
| [ESLint](https://eslint.org/), `@eslint/js`, `globals` | development only | MIT |

Fonts:

- **Noto Sans SC** and **Arvo** are loaded at run time from Google Fonts (SIL Open Font License 1.1); they are not in this repository.
- **Bender** (Jovanny Lemonad; Oleg Zhuravlev, Ivan Gladkikh) and **Novecento wide** (Jan Tonellato / Synthview) are free fonts under their authors' terms. They are not in this repository: the build fetches them from [TimWangZi/The-font-of-Arknights](https://github.com/TimWangZi/The-font-of-Arknights) into `assets/fonts/` (git-ignored) and inlines them into the built page.

Code:

- `tools/lib/spine-meta.mjs` (Spine skeleton reading, animation-role resolution) and `tools/lib/model-scales.mjs` (the enemy models' drawn scales, measured over the game client) are adapted from [Stronghold Protocol](https://github.com/sganggs/Stronghold-Protocol) (`tools/assets/skel.mjs`, `tools/assets/anim-roles.mjs`, `tools/build-data.mjs`), © its contributors, GPL-3.0-or-later. They are combined into this AGPL-3.0-or-later project as section 13 of the GNU GPL v3 permits; those files keep the GPL's terms for their own parts.

Data and models:

- `data/*.json` are generated from [ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData) (game data © Hypergryph; see NOTICE.md §2).
- `assets/models/` holds enemy Spine models from [isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models) and portraits from [yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource) (game art © Hypergryph; see NOTICE.md §2).

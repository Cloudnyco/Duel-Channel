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
- **Bender** and **Novecento wide** are part of the local asset pack (docs/ASSETS.md), not of this repository; they remain under their authors' licenses.

Data:

- `data/*.json` are generated from [ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData) (game data © Hypergryph; see NOTICE.md §2).

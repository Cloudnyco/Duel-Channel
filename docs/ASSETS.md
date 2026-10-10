# 素材包

页面需要的界面、动画、模型、音效和特效贴图是游戏素材（© Hypergryph），从游戏客户端导出，**收录在仓库的 `assets/` 中**，clone 下来就能构建。它们不适用本项目的 AGPL，只能用于非商业用途（[NOTICE.md](../NOTICE.md)）。

- 两款显示字体（Bender、Novecento wide）不是游戏素材，不在仓库中：构建时从 [TimWangZi/The-font-of-Arknights](https://github.com/TimWangZi/The-font-of-Arknights) 下载到 `assets/fonts/`（不提交），之后复用；下载失败时页面使用系统字体。
- 构建出的页面（`public/`）不提交。
- 素材包由维护者在游戏更新后统一更新，贡献者请不要改动 `assets/`。本项目不提供、也不说明任何绕过客户端保护的方法。

## 目录结构

```
assets/
  ui.json           活动界面：各界面与模板的节点树、精灵图、动画曲线、UI Spine、粒子贴图
  models/<原型>.json 一个原型敌人的模型与头像：{ icon, spine: { skel, atlas, pages, pma, anims } }（113 个）
  audio/*.ogg       界面音效（b_ui_dq*、g_ui_dq*、g_ui_tabswitch / matchsucceed / matchcancel）；可选 m_nobetnolife.ogg 作为默认 BGM
  fx/*              web/fx-map.json 列出的特效、地块与 buff 贴图
  fonts/            构建时下载的字体（不提交）
```

`npm run assets:check` 会列出缺少的文件（`npm run check` 也会检查仓库里的素材包是否完整）；齐全后 `npm run build`（或一键开服脚本）构建页面：

- `public/duel-flow.html`：单文件，素材内联，直接打开即可单机游玩；
- `public/index.html` + `public/pack/duel-pack.<哈希>.json` + `public/models/<原型>.<哈希>.json`：网关提供的版本。代码、素材包（界面、音效、特效、敌人头像与动画角色）和敌人模型分开，都按内容命名，浏览器可以长期缓存；模型在某场战斗用到时才下载（全部约 25 MB，一场只用到几个）。都附带 `.br` / `.gz` 压缩副本。

## 各部分来源

### ui.json

从活动的界面资源包（`ui/enemyduel/[uc]enemyduelbattle.ab`、`[uc]enemyduelouter.ab` 及其依赖的公共图集、着色器、表情包、加载图）导出的 UGUI 数据，格式：

```jsonc
{
  "screens": { "<预制体名>": { "name", "active", "rt": { amin, amax, pos, size, pivot, scale, rotz }, "comps": { … }, "children": [ … ] } },
  "sprites": { "<图集名>/<精灵名>" | "sprite/<名>" | "raw/<名>": { "w", "h", "uri": "data:image/png;base64,…", "border"? } },
  "clips":   { "<动画名>": { "wrap", "length", "curves": [ { "kind": "position|scale|euler|float|pptr", "path", "attr"?, "keys": [[t, v, inSlope, outSlope], …] } ] } },
  "spines":  { "<id>": { "json", "atlas", "pages": { "<页名>": "data:…" }, "scale" } },
  "ptex":    { "ptex/<名>": "data:…" }
}
```

`comps` 中的键与 Unity 组件的对应：`img`（UIAtlasImage / Image / RawImage）、`text`（Text + DynFontLoader）、`grad`、`mask`、`nodraw`、`lg`（布局组）、`csf`、`le`、`anim`、`spine`（SkeletonGraphic）、`particle`（UIParticle）、`mat`（材质：着色器名与参数）等，读取方式见 `web/src/engine.js`。

导出时需要额外处理的三点（引擎依赖这些结果）：

- 旧版动画的四元数旋转曲线（`m_RotationCurves`）换算为 z 轴欧拉角曲线；
- 带形状遮罩的材质（`_DissolveMapA`）把遮罩烘进精灵的透明通道，存为 `sprite/<精灵>@<遮罩>`；
- 每个带非默认材质的节点记下 `comps.mat`（形状着色器、UV 滚动等参数）；
- `panel_emoji` 取预制体的根节点（含全屏的 `btn_raycast` 和打开动画 `battle_ui_emoji_select_panel`），而不是同名的内层节点。

### models/

三期争锋频道（青草城、蜜果城、绿藤城）全部 113 种敌人的模型。争锋频道的敌人在客户端里按原型敌人（`originalEnemyId`）绘制，所以一个文件对应一个原型。来源都是社区维护的公开仓库：

- Spine 3.8 模型（skel、atlas、png）：[isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models) 的 `models_enemies/`；
- 头像：[yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource) 的 `enemy/`；
- 数据表：[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)。

```bash
node tools/build-data.mjs        # 下载到 .cache/sources/，写出 data/duelcfg.json、data/fighters.json、assets/models/
```

处理：atlas 补上每页的实际尺寸和 `pma: true`；从骨骼读出动画的名称、时长与 `OnAttack` 命中时间，按 Stronghold Protocol 的规则识别动画角色（待机、移动、攻击、技能、死亡、晕眩）；模型的显示缩放沿用 Stronghold Protocol 从客户端量出的原型缩放表（`tools/lib/model-scales.mjs`）。

Ark-Models 有 4 个原型只登记了名字、没有文件，用最接近的模型代替：山海众窥魅人、岩冠兽、矿脉守卫用同一敌人的另一版本（`_2`），灼热源石虫用普通源石虫（与 Stronghold Protocol 相同）。

### audio、fx、fonts

- `audio/`：活动的界面音效（客户端音频包中的 AudioClip），编码为 Ogg（Opus 或 Vorbis 均可）。
- `fx/`：`web/fx-map.json` 中每个角色对应的文件名。其中：
  - `bg1.jpg` 是礼物对决的主视觉；
  - `img_fx_*`、`img_uifx_*` 来自界面特效图集；
  - `T_starting_*` / `T_ending_*` / `flow_242` / `mask_*` / `kuangre_01` / `star_*` / `ray_13` / `bingkuai_02` / `xuehua_02` 来自战斗特效包（出入口、安全区边界线、buff）；
  - `map_ground.png` / `map_forbid.png` / `map_hlight.png` 是公共地图图集里地面、禁区地块和高台灯的裁切；
  - `img_dissolve_01.png` 是转场的方块噪声；
  - `pic_*.png` 是对战表情主题（`ui/emoticon/theme/[uc]emticon_duel_basic.ab`）的 12 个表情。
- `audio/m_nobetnolife.ogg`：默认 BGM（塞壬唱片），没有时页面不播放音乐，可以在设置里换曲。
- `fonts/`：见本页开头。

## 测试与 CI

`npm test` 只用 `data/` 和代码，不需要素材包。CI 还会用仓库里的素材包构建页面（一键开服脚本的 `--dry-run`），并检查网关提供的页面与素材包；没有页面时服务器也能启动，首页返回 503 说明需要先构建。

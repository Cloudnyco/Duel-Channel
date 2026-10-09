# 素材包

页面需要的美术、动画、模型、音效和字体都是游戏素材（© Hypergryph），**不在仓库中，也不会被提交**（`assets/` 和 `public/` 已被 `.gitignore` 排除，`npm run check` 会拒绝任何被跟踪的素材文件）。你需要在本机从**自己的**游戏客户端准备它们，构建出的页面也只供自己在本机或局域网使用，请勿再分发（[NOTICE.md](../NOTICE.md)）。

本项目不提供、也不说明任何绕过客户端保护的方法。

## 目录结构

```
assets/
  ui.json           活动界面：各界面与模板的节点树、精灵图、动画曲线、UI Spine、粒子贴图
  models.json       敌人模型与头像：{ <敌人 key>: { spine: { skel, atlas, pages, pma, anims }, icon } }
  audio/*.ogg       界面音效（b_ui_dq*、g_ui_dq*、g_ui_tabswitch / matchsucceed / matchcancel）；可选 m_nobetnolife.ogg 作为默认 BGM
  fx/*              web/fx-map.json 列出的特效、地块与 buff 贴图
  fonts/bender-regular.woff2
  fonts/novecento-wide-normal.woff2
```

`npm run assets:check` 会列出缺少的文件；齐全后 `npm run build` 把它们和代码一起内联成 `public/duel-flow.html`。

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

### models.json

每个敌人的 Spine 3.8 模型（skel 二进制与贴图页均为 base64）和头像。争锋频道的敌人在客户端里按原型敌人（`originalEnemyId`）绘制；本项目借用 [Stronghold Protocol](https://github.com/sganggs/Stronghold-Protocol) 的素材下载流程（`npm run assets`，从公开镜像获取敌人模型）：

```bash
node tools/build-data.mjs --gamedata <ArknightsGameData>/zh_CN/gamedata --models <Stronghold-Protocol 目录>
```

会同时写出 `data/fighters.json`（只含数值，提交到仓库）和 `assets/models.json`（模型，不提交）。

### audio、fx、fonts

- `audio/`：活动的界面音效（客户端音频包中的 AudioClip），编码为 Ogg（Opus 或 Vorbis 均可）。
- `fx/`：`web/fx-map.json` 中每个角色对应的文件名。其中：
  - `bg1.jpg` 是礼物对决的主视觉；
  - `img_fx_*`、`img_uifx_*` 来自界面特效图集；
  - `T_starting_*` / `T_ending_*` / `flow_242` / `mask_*` / `kuangre_01` / `star_*` / `ray_13` / `bingkuai_02` / `xuehua_02` 来自战斗特效包（出入口、安全区边界线、buff）；
  - `map_ground.png` / `map_forbid.png` / `map_hlight.png` 是公共地图图集里地面、禁区地块和高台灯的裁切；
  - `img_dissolve_01.png` 是转场的方块噪声；
  - `pic_*.png` 是对战表情主题（`ui/emoticon/theme/[uc]emticon_duel_basic.ab`）的 12 个表情。
- `fonts/`：Bender 与 Novecento wide（各自作者的许可）。

## 没有素材时

CI 和 `npm test` 不需要素材包：测试只用 `data/` 和代码。服务器没有页面也能启动，首页返回 503 说明需要先构建。

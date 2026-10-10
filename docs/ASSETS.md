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
  audio/*.ogg       界面音效（b_ui_dq*、g_ui_dq*、g_ui_tabswitch / matchsucceed / matchcancel）；可选 m_nobetnolife.ogg、m_all.ogg 作为 BGM
  fx/*              web/fx-map.json 列出的特效、地块、buff、表情与装置贴图
  traps.json        场地装置的模型：{ 装置: { tex（fx 角色）, v, uv, f } }（障碍物、源石祭坛）
  enemyfx.json      敌人的攻击特效（可选）：{ by: { 敌人: { s 起手, t 弹道, h 命中, arc, v } }, common, fx: { 特效: { d, ps, tr } }, tex, clamp }
  fonts/            构建时下载的字体（不提交）
```

`npm run assets:check` 会列出缺少的文件（`npm run check` 也会检查仓库里的素材包是否完整）；齐全后 `npm run build`（或一键开服脚本）构建页面：

- `public/duel-flow.html`：单文件，素材内联，直接打开即可单机游玩；
- `public/index.html` + `public/pack/duel-pack.<哈希>.json` + `public/models/<原型>.<哈希>.json` + `public/fx/enemyfx.<哈希>.json`：网关提供的版本。代码、素材包（界面、音效、特效、敌人头像与动画角色）和敌人模型分开，都按内容命名，浏览器可以长期缓存；模型在某场战斗用到时才下载（全部约 25 MB，一场只用到几个）。都附带 `.br` / `.gz` 压缩副本。

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
- 头像：[yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource) 的 `enemy/`，转成 WebP（质量 90，保留透明通道；`tools/lib/webp.mjs`，用编译成 WebAssembly 的 squoosh 编解码器 `@jsquash/png` / `@jsquash/webp`，不需要本机编译），全部头像从约 4.9 MB 减到约 1.2 MB；
- 数据表：[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)。

```bash
node tools/build-data.mjs        # 下载到 .cache/sources/，写出 data/duelcfg.json、data/fighters.json、assets/models/
```

处理：atlas 补上每页的实际尺寸和 `pma: true`；从骨骼读出动画的名称、时长与 `OnAttack` 命中时间，按 Stronghold Protocol 的规则识别动画角色（待机、移动、攻击、技能、死亡、晕眩）；模型的显示缩放沿用 Stronghold Protocol 从客户端量出的原型缩放表（`tools/lib/model-scales.mjs`）。

Ark-Models 有 4 个原型只登记了名字、没有文件，用最接近的模型代替：山海众窥魅人、岩冠兽、矿脉守卫用同一敌人的另一版本（`_2`），灼热源石虫用普通源石虫（与 Stronghold Protocol 相同）。

### enemyfx.json

敌人的攻击特效，从客户端的特效预制体导出（维护者的本地工具，不在仓库中）：

- 来源：敌人特效合包 `pkgrps/btl_pfb_fx_enemy_*`、早期敌人各自的 `battle/prefabs/effects/<代号>.ab`、通用特效 `battle/prefabs/effects/common.ab`，投射物预制体 `battle/prefabs/[uc]projectiles.ab`，贴图与材质在 `refs/fx/*`，着色器在 `[uc]shaders.ab`。
- 对应关系：按原型敌人的代号找特效名（`enemy_<代号>_attack…_start` / `_trail` / `_hit`，早期敌人没有 `enemy_` 前缀）；远程敌人以投射物预制体为准（`SimpleProjectile._mainEffect` 是弹道，`EffectBehaviour._effectsWhenHit` 是命中，`ParacurveMovement._raiseHeight` 是抛物线高度）。敌人预制体本身（动画事件绑定特效）是热更新资源，不在安装包里，所以起手特效的触发时机按特效本身推断：所有粒子都延迟 0.15 秒以上的随攻击动画开始播放，其余在命中 / 出手时播放。
- 每个特效是一组粒子系统（节点在特效空间中的位置与朝向、各模块参数、渲染方式，网格粒子带网格）和拖尾（`TrailRenderer` / `LineRenderer`）。材质按着色器的 GLES 程序换算为一种混合（叠加 / 透明）和一个颜色系数：`Torappu/Particles/Additive`、`AlphaBlend` 是 2 × `_TintColor`，`Dissolve` / `Disturb (CustomData)` 是 2 × `_MainColor`，`_PremultiplyAlpha` 开启时颜色再 × 2；溶解着色器记下溶解贴图、平铺、强度与边宽，自定义数据（Custom Data）曲线驱动 UV 偏移与溶解进度。`_MainTexChannel` 单通道贴图在导出时烘成灰度（键名 `<贴图>#R` 等），溶解噪声烘成不透明灰度（`#N0` 等）。
- 贴图缩到序列帧每格不超过 128 像素、整体不超过 256 像素，存为 WebP；`clamp` 列出导入设置为 Clamp 的贴图（其余平铺）。
- `MeshRenderer`（投射物本体等）导出网格与材质；用到 Unity 内置网格（Quad、Plane，不在任何资源包里）时按内置网格的形状补上。
- 尚未还原：由 Animator 驱动的节点动画（起手 / 命中特效里受它控制的网格暂不绘制，投射物上的按静止绘制）、粒子的子发射器与噪声模块。

### audio、fx、fonts

- `audio/`：活动的界面音效（客户端音频包中的 AudioClip），编码为 Ogg（Opus 或 Vorbis 均可）。
- `fx/`：`web/fx-map.json` 中每个角色对应的文件名。其中：
  - `bg1.jpg` 是礼物对决的主视觉；
  - `img_fx_*`、`img_uifx_*` 来自界面特效图集；
  - `T_starting_*` / `T_ending_*` / `flow_242` / `mask_*` / `kuangre_01` / `star_*` / `ray_13` / `bingkuai_02` / `xuehua_02` 来自战斗特效包（出入口、安全区边界线、buff）；
  - `map_ground.png` / `map_forbid.png` / `map_hlight.png` 是公共地图图集里地面、禁区地块和高台灯的裁切；
  - `img_dissolve_01.png` 是转场的方块噪声；
  - `sprite_enemy_boss_avatar_bg.png`、`sprite_enemy_boss_hp_bg.png`、`sprite_bar_glow.png`、`sprite_white_slider_fill.png`、`sprite_enemy_boss_hud_large.png` 和 `boss_avatar_enemy_1526_sfsui.png`（岁相的纹章）来自战斗界面公共包（`arts/ui/[uc]battlecommon.ab`），是巨型首领面板 `panel_enemy_boss_info`（`battle/[pack]common.ab`）用的贴图；
  - `pic_*.png` 是 5 个表情主题（`ui/emoticon/theme/[uc]emticon_duel_basic.ab`、`[uc]emoticon_foolsday_amiya` / `_wisdel` / `_doctor`、`[uc]emoticon_originium_slug`）中对战用的表情（12 + 4 × 6）；后加的 24 个按精灵的原始矩形（120 × 120）补回裁掉的透明边；
  - `TX_Common_wild_01.png`、`TX_curse_device.png`（缩到 512 × 512）是障碍物和源石祭坛的模型贴图，模型本身在 `traps.json`：两种装置的预制体在战斗装置合包 `pkgrps/btl_pfb_tokens_*` 里，网格分别来自 `arts/maps/common/meshes/s_common_box_01.ab` 和 `s_curse_device.ab`，材质在 `arts/maps/common/res.ab`；导出时把节点变换算进顶点，存为 [列偏移, 行偏移（向远侧为正）, 高度]（格）；
  - `shangdian_07.png`、`mask_08.png`、`flow_35.png`、`electric_01.png` 是梅什科线圈的特效贴图（`battle/prefabs/effects/map.ab` 的 `map_electric_grid_01` 电流、`map_electric_grid_start_01` 放电、`map_electric_grid_buff_01` 停顿，贴图在 `refs_fx_texture_*` 包里），`cansld_01.png` 是清债程序子弹 `trap_crsbow_attack_01_trail`（`battle/prefabs/effects/trap.ab`）的本体。线圈的预制体没有模型，游戏里平时看不见，只在放电时出现特效；线圈因此暂不出现在场上（`sim.js` 的 `TRAP_ON`），这几张贴图留给以后。
  - 弩炮的外形属于关卡场景，清债程序的炮台是特效 `trap_crsbow_effect`，这些在安装包和公开仓库里都没有，所以这两种装置暂不出现在场上。
- `audio/m_nobetnolife.ogg`、`audio/m_all.ogg`：BGM（塞壬唱片《No Bet, No Life》《ALL!》，由维护者提供的 WAV 编码为 128 kbps Opus），默认第一首，玩家可以在设置里切换（选择保存在浏览器里），也可以播放本地文件；两首都没有时页面不播放音乐。
- `fonts/`：见本页开头。

## 测试与 CI

`npm test` 只用 `data/` 和代码，不需要素材包。CI 还会用仓库里的素材包构建页面（一键开服脚本的 `--dry-run`），并检查网关提供的页面与素材包；没有页面时服务器也能启动，首页返回 503 说明需要先构建。

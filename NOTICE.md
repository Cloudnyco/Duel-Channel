# 版权与使用声明（NOTICE）

**争锋频道 · Duel Channel** 是《明日方舟》限时玩法「争锋频道」礼物对决的**非官方同人复刻**，与上海鹰角网络科技有限公司（Hypergryph）及其关联方**没有任何关联**，也未获得其授权或认可。

## 1. 代码许可证：AGPL-3.0-or-later

Copyright (C) 2026 Duel Channel contributors

本项目自己编写的源代码与文档文字（`web/`、`shared/`、`server/`、`tools/`、`test/`、`docs/` 下的代码与文字，以及根目录的配置文件）以 **GNU Affero 通用公共许可证第 3 版或（由你选择）任何更新版本**（AGPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。

- 第 13 条（远程网络交互）：如果你修改了本项目，并让用户通过网络与修改后的版本交互（例如架设联机服务器），你必须向这些用户提供修改后版本的对应源代码。页面开始界面的「源代码」链接就是为此准备的，请改为指向你的源代码。
- 通过 npm 安装的第三方库各自保留原许可证，见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

**附加许可（AGPL-3.0 第 7 条）** — Additional permission under GNU AGPL version 3 section 7:

> If you modify this Program, or any covered work, by linking or combining it with the Spine Runtimes (as shipped in
> pixi-spine, or a modified version of them), containing parts covered by the terms of the Spine Runtimes License
> Agreement, the licensors of this Program grant you additional permission to convey the resulting work.
> Corresponding Source for a non-source form of such a combination shall include the source code for the parts of
> the Spine Runtimes used as well as that of the covered work.

（大意：允许把本项目与 pixi-spine 中的 Spine Runtimes 组合后再分发；Spine Runtimes 本身仍受其自己的许可证约束。）

## 2. 不属于本项目、不受 AGPL 约束的内容

《明日方舟》及「争锋频道」相关的全部**名称、角色、美术、Spine 模型、界面图、动画、特效贴图、音乐音效、文本与游戏数据**，版权归上海鹰角网络科技有限公司及其授权方所有。具体包括：

- 素材包（`assets/**`，从游戏客户端导出，收录在仓库中）以及由它构建出的页面（`public/`）；
- 由官方数据表生成的 `data/duelcfg.json`、`data/fighters.json`，从客户端环境预制体读取的 `data/sources/*.json`，以及由这些数据计算出的 `test/fixtures/golden.json`；
- `docs/img/` 中的截图；
- `docs/` 中引用的 PRTS 等社区页面的文字（按其来源的许可，PRTS 文本为 CC BY-NC-SA）。

这些内容**不在 AGPL-3.0 授权范围内**，本项目也无权就它们向任何人授予任何权利。本项目收录它们仅为非商业的同人用途；你使用、转载或分发时同样只能用于非商业用途（第 3 节），并保留本声明。

两款显示字体 Bender 与 Novecento wide 不属于游戏素材，也不在仓库中：构建时从公开的字体仓库下载，适用其作者的许可（见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)）。

## 3. 仅限非商业用途

- 本项目仅供**学习、研究和个人非商业娱乐**。
- 游戏素材与数据仅可用于非商业用途，因此包含或依赖这些素材的一切内容（素材包本身、构建出的页面、架设的服务器、截图、录像与直播等）都**不得用于任何形式的盈利**，包括但不限于：出售或付费分发、收费开服或付费房间、植入广告、打赏与赞助、打包进任何收费产品或服务。
- AGPL 本身允许商业使用**代码**，上述限制针对的是不属于本项目的游戏素材与数据。

## 4. 权利人通知与删除

如果你是相关权利人，认为本项目的任何内容不妥，请提交 Issue 或通过 GitHub 联系仓库所有者，我们会尽快删除相关内容乃至整个仓库。

## 5. 免责声明

- 本项目按「原样」提供，**不附带任何明示或暗示的担保**（见 LICENSE 第 15、16 条）。
- 使用、架设或公开本项目的风险，包括网络安全与当地法律法规，由使用者自行承担。
- 本项目不需要也不会索取任何游戏账号。

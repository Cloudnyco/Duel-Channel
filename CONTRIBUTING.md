# 参与贡献

感谢你愿意参与。提交前请读完本页：Issue 和 Pull Request 都有固定的格式，不符合的可能会被要求修改或直接关闭。参与讨论和贡献请遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 在哪里说

| 你想… | 去哪里 |
|---|---|
| 报告 Bug（页面、对战、联机、构建） | [Issue →「Bug 反馈」](../../issues/new?template=bug_report.yml) |
| 指出规则或数值和官方不一致 | [Issue →「规则与官方不一致」](../../issues/new?template=mechanics.yml) |
| 提出新功能或改进 | [Issue →「功能建议」](../../issues/new?template=feature_request.yml) |
| 问怎么准备素材、构建、开服 | [Discussions → Q&A](../../discussions/categories/q-a) |
| 聊还不成熟的想法 | [Discussions → Ideas](../../discussions/categories/ideas) |
| 分享你的对局、截图、改造 | [Discussions → Show and tell](../../discussions/categories/show-and-tell) |
| 报告服务器安全漏洞 | [私下报告](../../security/advisories/new)（见 [SECURITY.md](SECURITY.md)），不要公开发 issue |
| 权利人要求删除内容 | [Issue →「权利人通知」](../../issues/new?template=rights.yml) |

## Issue 标准

- **一个 issue 只说一件事。** 多个问题请分开提。
- **先搜索**已有的 issue 和 Discussions，避免重复。
- **标题说清楚是什么**，例如「联机房间里房客看不到房主的头像」，不要只写「出 bug 了」。
- **Bug 要能复现**：写明步骤、期望与实际结果、环境（提交号、系统、浏览器、Node 版本），附上控制台错误或服务器日志。涉及某一轮对战时，附上那一轮的阵容（设置 → 回合记录）。
- **规则问题要有官方依据**：数据表的文件与字段、PRTS 页面、实机录像的链接与时间点。凭印象的描述很难核对。
- **不要上传任何游戏素材**（素材包、构建出的页面、模型、音频、字体）。截图和录屏可以。
- 不接受以盈利为目的的功能（见 [NOTICE.md](NOTICE.md)）。

使用方法、部署求助请发到 Discussions，不要开 issue。

### 标签

| 标签 | 含义 |
|---|---|
| `bug` | 程序错误 |
| `mechanics` | 规则 / 数值与官方不一致 |
| `enhancement` | 新功能或改进 |
| `documentation` | 文档 |
| `ci` | CI、构建、发布 |
| `dependencies` | 依赖更新（Dependabot） |
| `legal` | 权利人通知 |
| `question` | 求助（Discussions） |
| `good first issue` | 适合第一次贡献 |
| `help wanted` | 欢迎有人认领 |
| `wontfix` / `duplicate` / `invalid` | 不处理 / 重复 / 无效 |

## Pull Request 标准

- **一个 PR 只做一件事**，改动尽量小。大的改动请先开 issue 或在 Discussions 里商量。
- **从最新的 `main` 拉分支**，分支名说明用途，例如 `fix/room-avatar`、`feat/stand-mode`、`docs/deploy-lan`。
- **标题说明做了什么**（中文即可），例如「对战：过气水手的晕眩改为蓄满 3 次攻击后释放」。
- **按 PR 模板填写**：改动与原因、类型、验证方式。修复 issue 时写 `Closes #编号`。
- **界面改动附截图**，改动前后各一张；动效可以附录屏。
- **提交前运行**，CI 也会在 Ubuntu / Windows × Node 22 / 24 上跑一遍，全部通过才会合并：

  ```bash
  npm run check && npm run lint && npm test
  ```

- **改动了规则或数值**：
  - `npm test` 的黄金对局会失败。确认改动是有意的，运行 `node tools/golden.mjs`，并在 PR 里说明哪些对局变了、为什么。
  - 在 [docs/MECHANICS.md](docs/MECHANICS.md) 写明官方来源。按推断实现的，放进「按推断实现的部分」。
- **不要提交任何游戏素材**。`npm run check` 会检查。截图只放 `docs/img/`，压缩成 JPEG。
- **提交信息**：第一行说明做了什么（中文即可，50 字以内），空一行后写原因和细节。合并时会压缩为一个提交。

## 代码风格

- 页面脚本（`web/src/`、`shared/sim.js`）是经典脚本，不使用 `import`；它们被拼进同一个函数体，顶层名字共享。
- `shared/sim.js` 只用 IEEE 精确的运算（`Math.sqrt` 和加减乘除），不要用 `Math.hypot`、三角函数或 `**`，以保证各引擎结果一致。
- 注释说明「为什么」和官方来源，不复述代码。
- ESLint 配置见 `eslint.config.js`，`npm run lint` 不能有错误。

## 许可

提交即表示你同意以 AGPL-3.0-or-later 发布你的贡献（见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)）。

# 参与贡献

## 基本约定

- **不要提交任何游戏素材**（图片、模型、音频、字体、构建出的页面）。`npm run check` 会检查。截图只放 `docs/img/`，压缩成 JPEG。
- 一个 PR 只做一件事，标题说明做了什么（中文即可）。PR 描述里写清楚改动、验证方式和结果；界面改动附截图。
- 提交前运行：

  ```bash
  npm run check && npm run lint && npm test
  ```

- 改动了规则或数值时，`npm test` 的黄金对局会失败：确认改动是有意的，运行 `node tools/golden.mjs`，在 PR 里说明哪些对局变了、为什么。
- 新的规则请在 [docs/MECHANICS.md](docs/MECHANICS.md) 写明来源（数据表字段、客户端预制体或 PRTS 页面）；按推断实现的放进「按推断实现的部分」。

## 代码风格

- 页面脚本（`web/src/`、`shared/sim.js`）是经典脚本，不使用 `import`；它们被拼成一个函数体，顶层名字共享。
- `shared/sim.js` 只用 IEEE 精确的运算（`Math.sqrt` 和加减乘除），不要用 `Math.hypot`、三角函数或 `**`，以保证各引擎结果一致。
- 注释说明「为什么」和官方来源，不复述代码。

## 许可

提交即表示你同意以 AGPL-3.0-or-later 发布你的贡献（见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)）。

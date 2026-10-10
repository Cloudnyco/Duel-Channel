# 架构

## 页面（`web/`）

`tools/build-page.mjs` 用模板 `web/index.src.html`、各脚本、数据和素材包构建两种页面：

- `public/duel-flow.html`：素材包内联的单文件，以 `file://` 打开时是单机模式；
- `public/index.html` + `public/pack/duel-pack.<哈希>.json`：网关提供的版本。页面只含代码，`src/loader.js` 在开始页上显示进度并下载素材包（按内容哈希命名，可长期缓存），下完再启动游戏。

游戏代码在 `duelMain()` 里运行，它读取素材包的全局数据（`DUEL`、`FIGHTERS`、`AUDIO`、`FXTEX`）。脚本是**经典脚本**，按下面的顺序拼进同一个函数体，共享顶层名字：

| 文件 | 职责 |
|---|---|
| `src/report.js` | 错误报告：捕获未处理的错误与 Promise 拒绝，记录最近的操作（阶段、提示、连接状态、警告），生成报告（版本、浏览器与显卡、对局状态、每轮的阵容与种子），错误面板与提示；复制、预先填好的 GitHub Issue、发送给服务器主机 |
| `src/engine.js` | UGUI 重建：RectTransform 布局（锚点、轴心、布局组、ContentSizeFitter、LayoutElement）、Image / UIAtlasImage（九宫格画进一张画布图）、平铺与 UV 滚动、模板遮罩（`UIStencilComponent` / `UIStencilGraphic`，形状着色器 `ShapeCircle` / `ShapeRect`）、富文本与换行、旧版 AnimationClip（Hermite 插值）、UI Spine、`Screen` / `instantiate` |
| `src/particles.js` | UIParticle：按导出的发射器参数在 DOM 上模拟粒子 |
| `../shared/sim.js` | 对战模拟、阵容生成、NPC 选边、结算（页面和服务端共用） |
| `src/arena.js` | PixiJS 场地：透视地面网格（官方地块图集）、出入口、LED 墙、追光灯、安全区边界线、单位（Spine）、血条、buff / 晕眩 / 冻结效果、命中特效 |
| `src/net.js` | 联机：大厅与比赛的 WebSocket（`Link`）、延迟探测、服务端玩家、匹配与房间界面 |
| `src/emote.js` | 表情：顶栏的开关与表情面板、飘落弹幕（轨道选择、缓动曲线）、单机时 NPC 的表情 |
| `src/loader.js` | （仅网关提供的页面）下载素材包：开始页的占位条随进度填满，失败时提示刷新 |
| `src/flow.js` | 流程状态机（入口 → 选择赛事 → 匹配 / 房间 → 即将开始 → 加载 → 每轮押注、对战、回合结束、计分板 → 结算；礼物对决与竞猜对决共用，竞猜对决换用只选边的押注、观众保护与淘汰、全场一个榜的阶段结算）、方块溶解转场、设置面板与头像、开始界面 |

页面以 `file://` 打开时是单机模式；由网关以 http 提供时自动进入联机模式。

## 模拟（`shared/sim.js`）

- 固定步长 1/30 秒，`mulberry32` 随机数。只用 IEEE 精确的运算（`sqrt`、加减乘除），时间按整数步计数，所以 Node 和各浏览器逐位一致。
- `makeWorld(lineups, seed)` → `simStep(W)` 直到 `W.done`；`predict` 是无渲染的快速版本，服务端用它预先算出结果。
- 黄金对局（`test/fixtures/golden.json`，`tools/golden.mjs` 生成）锁定 40 场对战的阵容、胜负、结束步数和最终状态哈希。

## 服务端（`server/`）

| 文件 | 职责 |
|---|---|
| `launch.mjs` | 启动网关和 N 个实例（子进程，统一日志，Ctrl+C 全部停止）；子进程异常退出时自动重启（退避，一分钟内超过 5 次则放弃） |
| `errors.mjs` | 服务端错误记录（控制台、`logs/server-errors.log`、`/status` 中的最近错误）；未捕获异常记录后退出交给启动器重启；玩家错误报告写入 `logs/reports/` |
| `gateway.mjs` | 接收玩家的错误报告（`POST /report`，限大小与频率）；提供页面（按浏览器支持发送 brotli / gzip 压缩副本，带 ETag；素材包可长期缓存）；大厅（昵称、头像校验、匹配队列、群组房间）；`/status`、`/healthz`；把新比赛交给负载最低的实例，并把玩家的对局连接（`/match`）原样转发给它 |
| `instance.mjs` | 对战实例（只监听本机）：`POST /create`（仅本机）、`/status`、比赛的 WebSocket（经网关转发） |
| `game.mjs` | 一场比赛（礼物对决 8 人 / 竞猜对决 30 人）：NPC 补位、轮次、押注校验（观望 / 全力支持的条件；竞猜对决只选边）、预先模拟、等待所有人看完战斗、结算与排名（竞猜对决：观众保护、淘汰、无限轮次与结束条件）、表情转发（校验与限频）和 NPC 的表情 |
| `bots.mjs` | 机器人客户端（无渲染），测试与陪玩 |

消息（JSON over WebSocket）：

- 大厅：`hello` / `welcome`（带会话 `key`）、`resume`（断线后用 `key` 取回会话，失败时回 `resume.fail`）、`queue`（`mode`：`multiOperationMatch` 或 `multiStandMatch`，各自排队）/ `cancel`、`room.*`（`room.create` 的 `mode`：`multiOperationRoom` 或 `multiStandRoom`，人数上限随模式）、`avatar`、`matched`、`ping` / `pong`。
- 比赛：`hello`、`phase`、`round`（阵容 + 种子 + 押注时长）、`bets`、`battle`、`result`、`finish`、`ready` / `watched` / `bet` / `leave`、`emoji`（客户端发 `{ pic }`，服务端转发 `{ id, pic }`）、`ping` / `pong`。
  - 座位列表只在 `hello` 里带头像；`result` / `finish` 不带（30 个座位、每个头像最多 16 KB）。
  - 竞猜对决：`bet` 只有 `{ side }`；座位多出 `pass`（选对的轮数）、`shield`（还持有观众保护）、`shieldAt`（在第几轮用掉）、`saved`（本轮被保护）、`rank`；`hello` 的 `rounds` 为 `null`（不限轮数）。
- 断线重连：实例的每条广播都带递增的 `seq`，并保留在比赛的历史里（表情除外）。重连时带上 `since=<最后收到的 seq>`，实例补发之后的全部消息；不带 `since`（刷新页面后重新加入）时，从当前一轮的开头补发。补发的消息带 `age`（毫秒），客户端据此校准倒计时，对战落后太多时会快进追上。

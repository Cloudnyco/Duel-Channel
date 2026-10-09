# 安全策略

联机服务器（`server/`）接受来自浏览器的 WebSocket 消息。如果你发现可以让服务器崩溃、绕过押注校验、冒充其他玩家、读取或写入服务器文件等问题，请**不要公开发 issue**，而是通过 GitHub 的 [私下报告漏洞](https://github.com/Cloudnyco/Duel-Channel/security/advisories/new) 告诉我们，附上复现步骤。

我们会尽快确认并修复，修复发布后再公开说明。

只支持 `main` 分支的最新提交。服务器默认只监听本机（`127.0.0.1`），请不要把它直接暴露到公网（见 [docs/DEPLOY.md](docs/DEPLOY.md)）。

# PinHub · 宿舍拼单局

[打开在线拼单大厅](https://yxy077.github.io/pinhub/)

宿舍拼单演示版。游客可以浏览大厅，登录后可以发布、报名和取消报名。注册时请使用虚构信息和专用测试密码。

## 启动

需要 Node.js 18 或以上，无需安装依赖。在项目目录运行：

```sh
npm start
```

打开 http://127.0.0.1:3100。打开另一个浏览器或隐私窗口，就能用第二个演示账号体验报名和同步。

默认只在本机监听。需要让同一局域网的设备参与演示时，可运行 `HOST=0.0.0.0 npm start`，其他设备通过本机的局域网地址和 3100 端口访问。

## 数据与规则

- 首次启动会写入四条示例拼单。账号、登录会话和拼单保存在 `data/db.json`，本地会话密钥保存在 `data/session.key`。运行数据已由 Git 忽略。
- 注册填写账号、密码和昵称。发布拼单时可以选填宿舍号，演示时请填写虚构宿舍号。
- 大厅公开共享。拼单会公开显示商品信息、备注、报名昵称和所填宿舍号。
- 发起人自动计入目标人数且保留在拼单中。其他参与者可以在截止之前退出，满员也可以退出。
- 人均费用按当前报名人数均摊并四舍五入至分，仅供演示参考。
- 后端在同一个 Node.js 进程中管理 JSON 文件。部署时可以设置 `PORT`、`HOST`、`DATA_DIR`、`SESSION_SECRET`，HTTPS 下设置 `SECURE_COOKIES=1`。跨重启保留数据需要给 `DATA_DIR` 挂载持久化存储。

## 线上部署

GitHub Actions 将 `public/` 发布到 GitHub Pages。页面直接连接 Cloudflare Worker 的 HTTPS API，Worker 用 D1 保存账号、会话和拼单。本地 JSON 数据与线上数据库独立。

执行 `node build-worker.mjs --api-only` 生成 Worker 入口 `dist/server/index.js`。在 Cloudflare 中给 Worker 绑定名为 `DB` 的 D1 数据库，执行 `drizzle/0000_pinhub.sql`，并设置变量 `PAGES_ORIGIN=https://yxy077.github.io`。

GitHub Pages 的 API 地址由 `.github/workflows/pages.yml` 中的 `PINHUB_API_ORIGIN` 配置。

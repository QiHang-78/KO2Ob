# KOReader -> Server -> Obsidian Sync

这个仓库现在包含三部分：

1. `koreader-plugin/`
   KOReader 插件，读取当前书籍的高亮与笔记并上传到服务器。
2. `server/`
   轻量同步服务器，保存 KOReader 上传的高亮快照，并提供给 Obsidian 拉取。
3. `obsidian-plugin/`
   Obsidian 插件，从服务器拉取高亮并生成 Markdown 笔记。

原始参考脚本 `koreader-export.py` 仍保留在仓库根目录，方便继续对照之前基于 Calibre 的导出逻辑。

发布和安装说明见：

- [docs/PUBLISHING.md](/Users/qihang/Documents/ko2ob/docs/PUBLISHING.md)

## 设计思路

目标不是直接让 KOReader 写入 Obsidian Vault，而是拆成两段：

- KOReader 负责“上传当前书的高亮快照”
- 服务器负责“保存与分发”
- Obsidian 负责“拉取并渲染成 Markdown”

这样做的好处是：

- KOReader 端实现更简单
- Obsidian 客户端可以多端同步
- 后续可以继续接入别的阅读源

## API 概览

服务器默认提供这些接口：

- `GET /health`
- `POST /api/v1/documents`
- `GET /api/v1/documents`
- `GET /api/v1/documents/:id`
- `GET /api/v1/snapshot`

如果设置了环境变量 `KO2OB_API_KEY`，则写入和读取接口都需要：

- `x-api-key: <your-key>`

## 快速开始

### 1. 启动服务器

```bash
cd server
npm start
```

默认监听：

- `http://127.0.0.1:8787`

可通过环境变量覆盖：

- `KO2OB_HOST`
- `KO2OB_PORT`
- `KO2OB_DATA_FILE`
- `KO2OB_API_KEY`

### 1.1 用 Docker 启动服务器

直接构建并运行：

```bash
docker build -t ko2ob-server ./server
docker run --rm -p 8787:8787 \
  -e KO2OB_HOST=0.0.0.0 \
  -e KO2OB_PORT=8787 \
  -e KO2OB_DATA_FILE=/app/data/store.json \
  -e KO2OB_API_KEY=your-secret-key \
  -v "$(pwd)/server/data:/app/data" \
  ko2ob-server
```

如果你想用 `docker compose`：

```bash
docker compose up --build -d
```

相关文件：

- [server/Dockerfile](/Users/qihang/Documents/ko2ob/server/Dockerfile)
- [server/.dockerignore](/Users/qihang/Documents/ko2ob/server/.dockerignore)
- [docker-compose.yml](/Users/qihang/Documents/ko2ob/docker-compose.yml)

### 2. 安装 KOReader 插件

把整个目录：

- `koreader-plugin/koreaderobsidiansync.koplugin`

复制到 KOReader 的 `plugins/` 目录下。

打开书籍后，在主菜单里找到：

- `Obsidian Sync`

先配置：

- 服务器地址
- API Key（如果服务器启用）
- 设备名称

可选自动化设置：

- `Auto upload while reading`
- `Upload when closing book`
- `Idle delay before auto upload`

手动上传入口：

- `Upload current book highlights`

### 3. 安装 Obsidian 插件

```bash
cd obsidian-plugin
npm install
npm run build
```

把以下文件复制到你的 vault：

- `obsidian-plugin/main.js`
- `obsidian-plugin/manifest.json`
- `obsidian-plugin/styles.css`

目标目录应类似：

- `.obsidian/plugins/koreader-obsidian-sync/`

启用插件后，配置：

- Server URL
- API Key
- Output folder
- Auto sync interval（可选）

然后执行命令：

- `KOReader Sync: Pull highlights from server`

现在 Obsidian 端也支持：

- 增量拉取，只同步上次成功同步之后更新过的文档
- `Full resync from server` 命令，强制重新做一次全量同步
- 全量同步时清理服务器上已不存在、且由插件管理的本地笔记
- 状态栏显示最近一次同步摘要

## 当前实现范围

当前版本支持：

- KOReader 手动上传“当前书”的完整高亮快照
- KOReader 高亮/笔记变化后空闲几秒自动上传
- KOReader 关书时自动上传
- 服务器按书籍维度存储最新版本
- Obsidian 手动或定时增量拉取，并按书生成 Markdown
- Obsidian 全量同步时可清理远端已删除的已管理笔记

还没有做的部分：

- 服务器侧用户体系
- KOReader 端真正的增量上传
- Obsidian 端删除远端书籍时的自动清理
- 冲突合并策略

## 目录结构

```text
.
├── koreader-plugin/
├── obsidian-plugin/
├── server/
├── docs/
├── koreader-export.py
└── README.md
```

## 开发备注

- KOReader 插件没有依赖第三方包，直接使用 KOReader 自带 Lua 运行时和 HTTP/JSON 库。
- Obsidian 插件基于官方 sample plugin 结构。
- 服务器使用 Node.js 原生 `http` 模块，方便直接部署。

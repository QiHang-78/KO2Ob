# Publishing And Installation

这个项目目前分成三个发布对象：

1. `KOReader` 插件
2. `Obsidian` 插件
3. 同步服务器

## 本地打包

仓库内已经提供了一个简单打包脚本：

```bash
./scripts/package-release.sh
```

它会做这些事情：

- 构建 `Obsidian` 插件
- 生成 `KOReader` 插件 zip
- 生成 `Obsidian` 插件 zip
- 把发布产物放到 `dist/release/`

## GitHub 发布建议

建议在你自己的仓库中这样发布：

1. 新建仓库
2. 把当前代码推上去
3. 打一个 tag，例如 `v0.1.0`
4. 创建 GitHub Release
5. 上传以下附件

建议上传：

- `dist/release/koreader-koplugin-0.1.0.zip`
- `dist/release/koreader-obsidian-plugin-0.1.0.zip`
- `obsidian-plugin/manifest.json`
- `obsidian-plugin/main.js`
- `obsidian-plugin/styles.css`
- `obsidian-plugin/versions.json`

## KOReader 插件安装

安装方式：

1. 解压 `koreader-koplugin-0.1.0.zip`
2. 得到目录 `koreaderobsidiansync.koplugin`
3. 把整个目录复制到 KOReader 的 `plugins/` 目录
4. 重启 KOReader
5. 打开一本书，在菜单中找到 `Obsidian Sync`

首次配置：

- `Server URL`
- `API key`
- `Device name`

可选自动化：

- `Auto upload while reading`
- `Upload when closing book`
- `Idle delay before auto upload`

## Obsidian 插件安装

### 手动安装

把这些文件复制到：

```text
<your-vault>/.obsidian/plugins/koreader-obsidian-sync/
```

需要的文件：

- `main.js`
- `manifest.json`
- `styles.css`

然后：

1. 重启 Obsidian
2. 打开 Community Plugins
3. 启用 `KOReader Obsidian Sync`

### 发布为 GitHub Release

如果你后面想按 Obsidian 社区插件惯例发布，Release 附件至少要带：

- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`

## 服务器发布

### 直接运行

```bash
cd server
npm start
```

### Docker

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

### Docker Compose

```bash
docker compose up --build -d
```

## 推荐仓库结构

如果你打算单独维护自己的仓库，建议保持当前结构不变：

```text
.
├── koreader-plugin/
├── obsidian-plugin/
├── server/
├── scripts/
├── docs/
└── README.md
```

这样后面继续发版会最省事。

# Sync Payload

KOReader 上传到服务器的 JSON 结构：

```json
{
  "source": "koreader",
  "deviceId": "kobo-libra-2",
  "document": {
    "title": "Example Book",
    "author": "Someone",
    "sourcePath": "/mnt/onboard/books/example.epub",
    "numberOfPages": 320,
    "exportedAt": "2026-06-15T02:00:00Z",
    "entries": [
      {
        "sort": "highlight",
        "text": "Highlighted text",
        "note": "Optional note",
        "chapter": "Chapter 1",
        "page": 12,
        "color": "yellow",
        "drawer": "lighten",
        "createdAt": "2026-06-15T01:58:00Z",
        "updatedAt": "2026-06-15T01:59:00Z",
        "sourcePage": "xpath-or-page"
      }
    ]
  }
}
```

服务器返回的文档对象会额外包含：

```json
{
  "id": "book-id",
  "revision": 3,
  "contentHash": "sha256...",
  "createdAt": "2026-06-15T02:00:00Z",
  "updatedAt": "2026-06-15T02:01:00Z",
  "lastIngestedAt": "2026-06-15T02:01:00Z"
}
```

Obsidian 插件目前按 `contentHash` 判断是否需要重写本地 Markdown。

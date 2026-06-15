# KO2Ob v0.1.0

KOReader highlights can now flow through a lightweight sync server into Obsidian Markdown notes.

## What's Included

- KOReader plugin for manual and automatic highlight upload
- Node.js sync server with JSON API
- Docker and Docker Compose support for the server
- Obsidian plugin with:
  - incremental sync
  - full resync
  - cleanup of deleted remote documents managed by the plugin
  - sync status summary

## Highlights

### KOReader

- Upload current book highlights manually
- Auto upload after highlight or note changes
- Auto upload when closing a book
- Configurable idle delay before auto upload

### Server

- `POST /api/v1/documents`
- `GET /api/v1/documents`
- `GET /api/v1/documents/:id`
- `GET /api/v1/snapshot`
- `GET /health`
- Optional API key protection
- Docker healthcheck

### Obsidian

- Pull highlights from server into Markdown notes
- Incremental sync using `updated_after`
- Full resync command
- Optional cleanup of deleted remote documents
- Status bar sync summary

## Installation

Detailed installation steps are in:

- `README.md`
- `docs/PUBLISHING.md`

Release assets:

- `koreader-koplugin-0.1.0.zip`
- `koreader-obsidian-plugin-0.1.0.zip`

## Notes

- Docker assets are included, but Docker runtime validation depends on your local Docker installation.
- KOReader runtime behavior should still be verified on your actual device setup.

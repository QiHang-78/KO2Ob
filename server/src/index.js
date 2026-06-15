import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE =
	process.env.KO2OB_DATA_FILE ||
	path.resolve(__dirname, "../data/store.json");
const HOST = process.env.KO2OB_HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.KO2OB_PORT || "8787", 10);
const API_KEY = process.env.KO2OB_API_KEY || "";
const ENABLE_REQUEST_LOG = process.env.KO2OB_LOG_REQUESTS !== "false";

function nowIso() {
	return new Date().toISOString();
}

function stableStringify(value) {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

function slugify(value) {
	return String(value || "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/[\s_-]+/g, "-")
		.replace(/^-+|-+$/g, "") || "untitled";
}

function deriveDocumentId(document) {
	if (document.id && String(document.id).trim()) {
		return String(document.id).trim();
	}
	const base = `${document.title || ""}|${document.author || ""}|${document.sourcePath || ""}`;
	const shortHash = sha256(base).slice(0, 10);
	return `${slugify(document.title)}-${shortHash}`;
}

function summarizeDocument(document) {
	return {
		id: document.id,
		title: document.title,
		author: document.author,
		source: document.source,
		sourcePath: document.sourcePath,
		entryCount: document.entries.length,
		revision: document.revision,
		contentHash: document.contentHash,
		createdAt: document.createdAt,
		updatedAt: document.updatedAt,
		lastIngestedAt: document.lastIngestedAt,
		exportedAt: document.exportedAt || null,
	};
}

async function ensureDataFile() {
	await mkdir(path.dirname(DATA_FILE), { recursive: true });
	try {
		await readFile(DATA_FILE, "utf8");
	} catch {
		const initial = {
			version: 1,
			createdAt: nowIso(),
			updatedAt: nowIso(),
			documents: {},
		};
		await writeFile(DATA_FILE, JSON.stringify(initial, null, 2));
	}
}

async function loadStore() {
	await ensureDataFile();
	const raw = await readFile(DATA_FILE, "utf8");
	const parsed = JSON.parse(raw);
	if (!parsed.documents || typeof parsed.documents !== "object") {
		parsed.documents = {};
	}
	return parsed;
}

async function saveStore(store) {
	store.updatedAt = nowIso();
	const tempFile = `${DATA_FILE}.tmp`;
	await writeFile(tempFile, JSON.stringify(store, null, 2));
	await rename(tempFile, DATA_FILE);
}

function logRequest(req, statusCode, startedAt) {
	if (!ENABLE_REQUEST_LOG) {
		return;
	}
	const durationMs = Date.now() - startedAt;
	console.log(
		`${new Date().toISOString()} ${req.method} ${req.url} ${statusCode} ${durationMs}ms`,
	);
}

function sendJson(res, statusCode, payload) {
	res.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	});
	res.end(JSON.stringify(payload, null, 2));
}

function unauthorized(res) {
	sendJson(res, 401, {
		ok: false,
		error: "Unauthorized",
	});
}

function isAuthorized(req) {
	if (!API_KEY) {
		return true;
	}
	const apiKey = req.headers["x-api-key"];
	if (apiKey && apiKey === API_KEY) {
		return true;
	}
	const authHeader = req.headers.authorization || "";
	if (authHeader === `Bearer ${API_KEY}`) {
		return true;
	}
	return false;
}

function validateEntry(entry, index) {
	if (!entry || typeof entry !== "object") {
		return `entries[${index}] must be an object`;
	}
	if (!entry.text || typeof entry.text !== "string") {
		return `entries[${index}].text is required`;
	}
	return null;
}

function validatePayload(payload) {
	if (!payload || typeof payload !== "object") {
		return "Payload must be a JSON object";
	}
	if (!payload.document || typeof payload.document !== "object") {
		return "document is required";
	}
	const document = payload.document;
	if (!document.title || typeof document.title !== "string") {
		return "document.title is required";
	}
	if (!Array.isArray(document.entries)) {
		return "document.entries must be an array";
	}
	for (let index = 0; index < document.entries.length; index += 1) {
		const error = validateEntry(document.entries[index], index);
		if (error) {
			return error;
		}
	}
	return null;
}

async function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			try {
				resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

function normalizeEntries(entries) {
	return entries.map((entry) => ({
		sort: entry.sort || "highlight",
		text: String(entry.text || "").trim(),
		note: entry.note ? String(entry.note).trim() : "",
		chapter: entry.chapter ? String(entry.chapter).trim() : "",
		page:
			typeof entry.page === "number" || typeof entry.page === "string"
				? entry.page
				: null,
		color: entry.color ? String(entry.color) : null,
		drawer: entry.drawer ? String(entry.drawer) : null,
		createdAt: entry.createdAt || null,
		updatedAt: entry.updatedAt || null,
		sourcePage: entry.sourcePage ?? null,
	}));
}

async function upsertDocument(payload) {
	const store = await loadStore();
	const now = nowIso();
	const input = payload.document;
	const id = deriveDocumentId(input);
	const previous = store.documents[id];
	const normalizedEntries = normalizeEntries(input.entries);
	const normalizedDocument = {
		id,
		source: payload.source || "koreader",
		deviceId: payload.deviceId || "unknown-device",
		title: input.title,
		author: input.author || "",
		sourcePath: input.sourcePath || "",
		numberOfPages:
			typeof input.numberOfPages === "number" ? input.numberOfPages : null,
		exportedAt: input.exportedAt || null,
		entries: normalizedEntries,
	};
	const contentHash = sha256(stableStringify(normalizedDocument));
	const createdAt = previous?.createdAt || now;
	const changed = previous?.contentHash !== contentHash;
	const document = {
		...normalizedDocument,
		contentHash,
		revision: previous ? previous.revision + (changed ? 1 : 0) : 1,
		createdAt,
		updatedAt: changed ? now : previous?.updatedAt || now,
		lastIngestedAt: now,
	};
	store.documents[id] = document;
	await saveStore(store);
	return document;
}

function sortDocuments(documents) {
	return [...documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function handleListDocuments(req, res) {
	const url = new URL(req.url, `http://${req.headers.host}`);
	const updatedAfter = url.searchParams.get("updated_after");
	const store = await loadStore();
	let documents = Object.values(store.documents);
	if (updatedAfter) {
		documents = documents.filter((document) => document.updatedAt > updatedAfter);
	}
	sendJson(res, 200, {
		ok: true,
		documents: sortDocuments(documents).map(summarizeDocument),
	});
}

async function handleSnapshot(req, res) {
	const url = new URL(req.url, `http://${req.headers.host}`);
	const updatedAfter = url.searchParams.get("updated_after");
	const store = await loadStore();
	let documents = Object.values(store.documents);
	if (updatedAfter) {
		documents = documents.filter((document) => document.updatedAt > updatedAfter);
	}
	sendJson(res, 200, {
		ok: true,
		documents: sortDocuments(documents),
	});
}

async function handleGetDocument(req, res, id) {
	const store = await loadStore();
	const document = store.documents[id];
	if (!document) {
		sendJson(res, 404, {
			ok: false,
			error: "Document not found",
		});
		return;
	}
	sendJson(res, 200, {
		ok: true,
		document,
	});
}

const server = http.createServer(async (req, res) => {
	const startedAt = Date.now();
	try {
		if (req.method === "OPTIONS") {
			sendJson(res, 200, { ok: true });
			logRequest(req, 200, startedAt);
			return;
		}

		const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

		if (req.method === "GET" && pathname === "/health") {
			const store = await loadStore();
			sendJson(res, 200, {
				ok: true,
				time: nowIso(),
				documents: Object.keys(store.documents).length,
			});
			logRequest(req, 200, startedAt);
			return;
		}

		if (
			(pathname.startsWith("/api/") || pathname === "/api/v1/snapshot") &&
			!isAuthorized(req)
		) {
			unauthorized(res);
			logRequest(req, 401, startedAt);
			return;
		}

		if (req.method === "POST" && pathname === "/api/v1/documents") {
			const payload = await readBody(req);
			const error = validatePayload(payload);
			if (error) {
				sendJson(res, 400, {
					ok: false,
					error,
				});
				logRequest(req, 400, startedAt);
				return;
			}
			const document = await upsertDocument(payload);
			sendJson(res, 200, {
				ok: true,
				document: summarizeDocument(document),
			});
			logRequest(req, 200, startedAt);
			return;
		}

		if (req.method === "GET" && pathname === "/api/v1/documents") {
			await handleListDocuments(req, res);
			logRequest(req, 200, startedAt);
			return;
		}

		if (req.method === "GET" && pathname === "/api/v1/snapshot") {
			await handleSnapshot(req, res);
			logRequest(req, 200, startedAt);
			return;
		}

		const documentMatch = pathname.match(/^\/api\/v1\/documents\/([^/]+)$/);
		if (req.method === "GET" && documentMatch) {
			await handleGetDocument(req, res, decodeURIComponent(documentMatch[1]));
			logRequest(req, 200, startedAt);
			return;
		}

		sendJson(res, 404, {
			ok: false,
			error: "Not found",
		});
		logRequest(req, 404, startedAt);
	} catch (error) {
		sendJson(res, 500, {
			ok: false,
			error: error instanceof Error ? error.message : "Unknown server error",
		});
		logRequest(req, 500, startedAt);
	}
});

await ensureDataFile();
server.listen(PORT, HOST, () => {
	console.log(`KO2OB server listening on http://${HOST}:${PORT}`);
	console.log(`Data file: ${DATA_FILE}`);
});

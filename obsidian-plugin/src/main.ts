import {
	FuzzySuggestModal,
	Notice,
	Plugin,
	requestUrl,
	TFile,
	type TFolder,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	type KO2OBSettings,
	KO2OBSettingTab,
} from "./settings";

interface RemoteDocumentEntry {
	sort: string;
	text: string;
	note: string;
	chapter: string;
	page: number | string | null;
	color: string | null;
	drawer: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	sourcePage: string | number | null;
}

interface RemoteDocument {
	id: string;
	source: string;
	deviceId: string;
	title: string;
	author: string;
	sourcePath: string;
	numberOfPages: number | null;
	exportedAt: string | null;
	entries: RemoteDocumentEntry[];
	contentHash: string;
	revision: number;
	createdAt: string;
	updatedAt: string;
	lastIngestedAt: string;
}

interface SnapshotResponse {
	ok: boolean;
	documents: RemoteDocument[];
}

interface SyncResult {
	checked: number;
	changed: number;
	incremental: boolean;
	removed: number;
}

function sanitizeFileSegment(value: string): string {
	return value
		.replace(/[\\/:*?"<>|]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\.$/, "") || "Untitled";
}

function renderFrontmatter(document: RemoteDocument): string {
	const author = document.author || "";
	const pages = document.numberOfPages ?? "";
	return [
		"---",
		`title: ${JSON.stringify(document.title)}`,
		`author: ${JSON.stringify(author)}`,
		`ko2obDocumentId: ${JSON.stringify(document.id)}`,
		`ko2obRevision: ${document.revision}`,
		`ko2obContentHash: ${JSON.stringify(document.contentHash)}`,
		`ko2obDeviceId: ${JSON.stringify(document.deviceId)}`,
		`ko2obExportedAt: ${JSON.stringify(document.exportedAt || "")}`,
		`pages: ${JSON.stringify(pages)}`,
		"tags:",
		"  - koreader",
		"---",
		"",
	].join("\n");
}

function renderEntry(entry: RemoteDocumentEntry): string {
	const lines = ["[!quote]"];
	for (const line of entry.text.split("\n")) {
		lines.push(`> ${line}`);
	}
	const parts = [lines.join("\n")];
	const meta: string[] = [];
	if (entry.page !== null && entry.page !== "") {
		meta.push(`page ${entry.page}`);
	}
	if (entry.color) {
		meta.push(entry.color);
	}
	if (entry.updatedAt || entry.createdAt) {
		meta.push(entry.updatedAt || entry.createdAt || "");
	}
	if (meta.length > 0) {
		parts.push(`_(${meta.join(" | ")})_`);
	}
	if (entry.note) {
		for (const line of entry.note.split("\n")) {
			parts.push(`- ${line}`);
		}
	}
	return parts.join("\n");
}

function renderMarkdown(document: RemoteDocument, includeFrontmatter: boolean): string {
	const sections = new Map<string, RemoteDocumentEntry[]>();
	for (const entry of document.entries) {
		const chapter = entry.chapter?.trim() || "Highlights";
		const list = sections.get(chapter) || [];
		list.push(entry);
		sections.set(chapter, list);
	}

	const lines: string[] = [];
	if (includeFrontmatter) {
		lines.push(renderFrontmatter(document));
	}
	lines.push(`# ${document.title}`);
	lines.push("");
	if (document.author) {
		lines.push(`Author: ${document.author}`);
		lines.push("");
	}
	if (document.sourcePath) {
		lines.push(`Source: \`${document.sourcePath}\``);
		lines.push("");
	}
	for (const [chapter, entries] of sections) {
		lines.push(`## ${chapter}`);
		lines.push("");
		for (const entry of entries) {
			lines.push(renderEntry(entry));
			lines.push("");
		}
	}
	lines.push(`_Last synced: ${new Date().toISOString()}_`);
	lines.push("");
	return lines.join("\n");
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private readonly folders: TFolder[];
	private readonly onChoose: (folderPath: string) => Promise<void> | void;

	constructor(plugin: KOReaderObsidianSyncPlugin, onChoose: (folderPath: string) => Promise<void> | void) {
		super(plugin.app);
		this.folders = plugin.app.vault.getAllFolders();
		this.onChoose = onChoose;
		this.setPlaceholder("Choose an output folder");
	}

	getItems(): TFolder[] {
		return this.folders;
	}

	getItemText(folder: TFolder): string {
		return folder.path || "/";
	}

	onChooseItem(folder: TFolder): void {
		void this.onChoose(folder.path);
	}
}

export default class KOReaderObsidianSyncPlugin extends Plugin {
	settings!: KO2OBSettings;
	private autoSyncTimer: number | null = null;
	private statusBarItemEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon("book-up", "Sync KOReader highlights", async () => {
			await this.syncFromServer(true);
		});

		this.addCommand({
			id: "pull-highlights-from-server",
			name: "Pull highlights from server",
			callback: async () => {
				await this.syncFromServer(true);
			},
		});

		this.addCommand({
			id: "full-resync-from-server",
			name: "Full resync from server",
			callback: async () => {
				await this.resetSyncState();
				await this.syncFromServer(true);
			},
		});

		this.addCommand({
			id: "choose-output-folder",
			name: "Choose output folder",
			callback: async () => {
				this.openFolderPicker();
			},
		});

		this.addCommand({
			id: "open-output-folder",
			name: "Open output folder",
			callback: async () => {
				await this.ensureFolder(this.settings.outputFolder);
				const folder = this.app.vault.getFolderByPath(this.settings.outputFolder) as TFolder | null;
				if (folder && folder.children.length > 0 && folder.children[0] instanceof TFile) {
					await this.app.workspace.getLeaf().openFile(folder.children[0]).catch(() => undefined);
				} else {
					new Notice(`Output folder ready: ${this.settings.outputFolder}`);
				}
			},
		});

		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar();
		this.addSettingTab(new KO2OBSettingTab(this.app, this));
		this.configureAutoSync();
	}

	onunload() {
		if (this.autoSyncTimer !== null) {
			window.clearInterval(this.autoSyncTimer);
		}
	}

	configureAutoSync() {
		if (this.autoSyncTimer !== null) {
			window.clearInterval(this.autoSyncTimer);
			this.autoSyncTimer = null;
		}
		if (this.settings.autoSyncMinutes > 0) {
			this.autoSyncTimer = window.setInterval(() => {
				void this.syncFromServer(false);
			}, this.settings.autoSyncMinutes * 60 * 1000);
			this.registerInterval(this.autoSyncTimer);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<KO2OBSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateStatusBar();
	}

	openFolderPicker() {
		new FolderSuggestModal(this, async (folderPath) => {
			this.settings.outputFolder = folderPath || DEFAULT_SETTINGS.outputFolder;
			await this.saveSettings();
			new Notice(`KOReader output folder set to: ${this.settings.outputFolder}`);
		}).open();
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.settings.apiKey) {
			headers["x-api-key"] = this.settings.apiKey;
		}
		return headers;
	}

	private getManagedFilePath(document: RemoteDocument): string {
		const existingPath = this.settings.managedDocuments[document.id];
		if (existingPath) {
			return existingPath;
		}
		const template = this.settings.fileNameTemplate;
		const fileName = sanitizeFileSegment(
			template
				.replace(/\{\{title\}\}/g, document.title || "Untitled")
				.replace(/\{\{author\}\}/g, document.author || "Unknown"),
		);
		return `${this.settings.outputFolder}/${fileName}.md`;
	}

	private async ensureFolder(folderPath: string) {
		if (!folderPath) {
			return;
		}
		if (this.app.vault.getFolderByPath(folderPath)) {
			return;
		}
		await this.app.vault.createFolder(folderPath).catch(() => undefined);
	}

	private buildSnapshotUrl(): string {
		const base = this.settings.serverUrl.replace(/\/+$/, "");
		const lastSnapshotSyncAt = this.settings.lastSnapshotSyncAt;
		const params = new URLSearchParams();
		if (lastSnapshotSyncAt) {
			params.set("updated_after", lastSnapshotSyncAt);
		}
		const query = params.toString();
		return `${base}/api/v1/snapshot${query ? `?${query}` : ""}`;
	}

	private async fetchSnapshot(): Promise<{ documents: RemoteDocument[]; incremental: boolean }> {
		const url = this.buildSnapshotUrl();
		const response = await requestUrl({
			url,
			method: "GET",
			headers: this.buildHeaders(),
		});
		const data = response.json as SnapshotResponse;
		if (!data.ok || !Array.isArray(data.documents)) {
			throw new Error("Invalid snapshot response");
		}
		return {
			documents: data.documents,
			incremental: Boolean(this.settings.lastSnapshotSyncAt),
		};
	}

	private async writeDocument(document: RemoteDocument): Promise<boolean> {
		await this.ensureFolder(this.settings.outputFolder);
		const filePath = this.getManagedFilePath(document);
		const content = renderMarkdown(document, this.settings.includeFrontmatter);
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			const current = await this.app.vault.cachedRead(existing);
			if (current.includes(`ko2obContentHash: ${JSON.stringify(document.contentHash)}`)) {
				this.settings.managedDocuments[document.id] = filePath;
				return false;
			}
			await this.app.vault.modify(existing, content);
			this.settings.managedDocuments[document.id] = filePath;
			return true;
		}
		await this.app.vault.create(filePath, content);
		this.settings.managedDocuments[document.id] = filePath;
		return true;
	}

	private async fetchAllDocumentSummaries(): Promise<Array<{ id: string }>> {
		const base = this.settings.serverUrl.replace(/\/+$/, "");
		const response = await requestUrl({
			url: `${base}/api/v1/documents`,
			method: "GET",
			headers: this.buildHeaders(),
		});
		const data = response.json as { ok: boolean; documents: Array<{ id: string }> };
		if (!data.ok || !Array.isArray(data.documents)) {
			throw new Error("Invalid documents response");
		}
		return data.documents;
	}

	private async cleanupDeletedDocuments(remoteIds: Set<string>): Promise<number> {
		if (!this.settings.cleanupDeletedDocuments) {
			return 0;
		}
		const managedEntries = Object.entries(this.settings.managedDocuments || {});
		let removed = 0;
		for (const [documentId, filePath] of managedEntries) {
			if (remoteIds.has(documentId)) {
				continue;
			}
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				await this.app.vault.delete(file);
				removed += 1;
			}
			delete this.settings.managedDocuments[documentId];
		}
		return removed;
	}

	private pruneManagedDocuments() {
		for (const [documentId, filePath] of Object.entries(this.settings.managedDocuments || {})) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) {
				delete this.settings.managedDocuments[documentId];
			}
		}
	}

	private updateStatusBar() {
		if (!this.statusBarItemEl) {
			return;
		}
		const summary = this.settings.lastSyncSummary || "Never synced";
		this.statusBarItemEl.setText(`KOReader Sync: ${summary}`);
	}

	async resetSyncState() {
		this.settings.lastSnapshotSyncAt = "";
		this.settings.lastSyncSummary = "Sync state reset";
		await this.saveSettings();
	}

	async syncFromServer(showNotice: boolean): Promise<SyncResult> {
		try {
			this.pruneManagedDocuments();
			const { documents, incremental } = await this.fetchSnapshot();
			let changed = 0;
			for (const document of documents) {
				const didWrite = await this.writeDocument(document);
				if (didWrite) {
					changed += 1;
				}
			}
			let removed = 0;
			if (!incremental) {
				const summaries = await this.fetchAllDocumentSummaries();
				const remoteIds = new Set(summaries.map((document) => document.id));
				removed = await this.cleanupDeletedDocuments(remoteIds);
			}
			const now = new Date().toISOString();
			this.settings.lastSyncedAt = now;
			this.settings.lastSnapshotSyncAt = now;
			this.settings.lastSyncSummary = `${incremental ? "Incremental" : "Full"}: ${documents.length} checked, ${changed} updated, ${removed} removed`;
			await this.saveSettings();
			if (showNotice) {
				new Notice(`KOReader sync complete: ${documents.length} docs checked, ${changed} updated, ${removed} removed.`);
			}
			return {
				checked: documents.length,
				changed,
				incremental,
				removed,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown sync error";
			this.settings.lastSyncSummary = `Failed: ${message}`;
			await this.saveSettings();
			if (showNotice) {
				new Notice(`KOReader sync failed: ${message}`);
			}
			throw error;
		}
	}
}

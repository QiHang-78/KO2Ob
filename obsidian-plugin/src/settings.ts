import { App, PluginSettingTab, Setting } from "obsidian";
import type KOReaderObsidianSyncPlugin from "./main";

export interface KO2OBSettings {
	serverUrl: string;
	apiKey: string;
	outputFolder: string;
	fileNameTemplate: string;
	autoSyncMinutes: number;
	includeFrontmatter: boolean;
	lastSyncedAt: string;
	lastSnapshotSyncAt: string;
	lastSyncSummary: string;
	cleanupDeletedDocuments: boolean;
	managedDocuments: Record<string, string>;
}

export const DEFAULT_SETTINGS: KO2OBSettings = {
	serverUrl: "http://127.0.0.1:8787",
	apiKey: "",
	outputFolder: "KOReader Highlights",
	fileNameTemplate: "{{title}}",
	autoSyncMinutes: 0,
	includeFrontmatter: true,
	lastSyncedAt: "",
	lastSnapshotSyncAt: "",
	lastSyncSummary: "",
	cleanupDeletedDocuments: true,
	managedDocuments: {},
};

export class KO2OBSettingTab extends PluginSettingTab {
	plugin: KOReaderObsidianSyncPlugin;

	constructor(app: App, plugin: KOReaderObsidianSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("Sync server base URL.")
			.addText((text) =>
				text
					.setPlaceholder("http://127.0.0.1:8787")
					.setValue(this.plugin.settings.serverUrl)
					.onChange(async (value) => {
						this.plugin.settings.serverUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("API key")
			.setDesc("Optional x-api-key header.")
			.addText((text) =>
				text
					.setPlaceholder("Optional")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Output folder")
			.setDesc("Folder inside the vault where Markdown notes will be written. One book becomes one Markdown file.")
			.addText((text) =>
				text
					.setPlaceholder("KOReader Highlights")
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value.trim() || DEFAULT_SETTINGS.outputFolder;
						await this.plugin.saveSettings();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Choose").onClick(() => {
					this.plugin.openFolderPicker();
				}),
			);

		new Setting(containerEl)
			.setName("Filename template")
			.setDesc("Currently supports {{title}} and {{author}}.")
			.addText((text) =>
				text
					.setPlaceholder("{{title}}")
					.setValue(this.plugin.settings.fileNameTemplate)
					.onChange(async (value) => {
						this.plugin.settings.fileNameTemplate = value.trim() || DEFAULT_SETTINGS.fileNameTemplate;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto sync interval")
			.setDesc("Minutes between sync runs. Set to 0 to disable.")
			.addText((text) =>
				text
					.setPlaceholder("0")
					.setValue(String(this.plugin.settings.autoSyncMinutes))
					.onChange(async (value) => {
						const minutes = Number.parseInt(value, 10);
						this.plugin.settings.autoSyncMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
						await this.plugin.saveSettings();
						this.plugin.configureAutoSync();
					}),
			);

		new Setting(containerEl)
			.setName("Include frontmatter")
			.setDesc("Add YAML frontmatter for title, author, and sync metadata.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.includeFrontmatter).onChange(async (value) => {
					this.plugin.settings.includeFrontmatter = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Clean up deleted remote documents")
			.setDesc("During full resync, delete local notes previously created by this plugin if they no longer exist on the server.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.cleanupDeletedDocuments).onChange(async (value) => {
					this.plugin.settings.cleanupDeletedDocuments = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Last synced at")
			.setDesc(this.plugin.settings.lastSyncedAt || "Never")
			.addButton((button) =>
				button.setButtonText("Sync now").onClick(async () => {
					await this.plugin.syncFromServer(true);
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Last sync summary")
			.setDesc(this.plugin.settings.lastSyncSummary || "No sync has run yet.")
			.addButton((button) =>
				button.setButtonText("Full resync").onClick(async () => {
					await this.plugin.resetSyncState();
					await this.plugin.syncFromServer(true);
					this.display();
				}),
			);
	}
}

import esbuild from "esbuild";
import process from "node:process";

const production = process.argv.includes("production");

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2020",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view"],
	logLevel: "info",
});

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}

import { defineConfig } from "tsup"

export default defineConfig({
	format: ["cjs", "esm"],
	entry: {
		index: "./src/index.ts",
		calendar: "./src/calendar.ts",
		testing: "./src/testing-entry.ts",
		convenience: "./src/convenience/index.ts",
		validate: "./src/validate.ts",
		dkim: "./src/dkim.ts",
		batch: "./src/batch.ts",
		preview: "./src/preview.ts",
		thread: "./src/thread.ts",
		unsubscribe: "./src/unsubscribe.ts",
		"html-to-text": "./src/html-to-text.ts",
		template: "./src/template.ts",
		builder: "./src/builder.ts",
		plugins: "./src/plugins/index.ts",
	},
	dts: true,
	shims: true,
	minify: false,
	skipNodeModulesBundle: true,
	clean: true,
})

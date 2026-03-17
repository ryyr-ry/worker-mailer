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
	},
	dts: true,
	shims: true,
	minify: true,
	skipNodeModulesBundle: true,
	clean: true,
})

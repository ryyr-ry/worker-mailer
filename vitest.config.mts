import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./test/wrangler.toml" },
			main: "./test/worker.ts",
		}),
	],
	test: {
		// close() テストで意図的に発生する Unhandled Rejection を許容する
		// vitest 4.x ではデフォルトで exitCode=1 にされるため必要
		dangerouslyIgnoreUnhandledErrors: true,
	},
})

import type Logger from "../logger"
import { backoff } from "../utils"
import type { SendHooks } from "./types"

export interface ReconnectDeps {
	recreateTransport: () => Promise<void>
	logger: Logger
	hooks?: SendHooks
}

export async function reconnect(deps: ReconnectDeps): Promise<boolean> {
	for (let i = 0; i < 3; i++) {
		try {
			deps.logger.info(`[WorkerMailer] Reconnecting (attempt ${i + 1}/3)`)
			deps.hooks?.onReconnecting?.({ attempt: i + 1 })
			await deps.recreateTransport()
			deps.logger.info("[WorkerMailer] Reconnection successful")
			return true
		} catch (err: unknown) {
			deps.logger.error(
				`[WorkerMailer] Reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
			)
			if (i < 2) await backoff(i)
		}
	}
	return false
}

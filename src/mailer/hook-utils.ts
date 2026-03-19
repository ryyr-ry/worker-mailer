import type Logger from "../logger"

export async function tryHook<T extends unknown[]>(
	logger: Logger,
	name: string,
	hook: ((...args: T) => unknown) | undefined,
	...args: T
): Promise<void> {
	try {
		await hook?.(...args)
	} catch (e: unknown) {
		logger.error(`[WorkerMailer] ${name} hook error`, e)
	}
}

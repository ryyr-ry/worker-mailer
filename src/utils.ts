export * from "./encoding"
export * from "./queue"

export async function execTimeout<T>(promise: Promise<T>, ms: number, e: Error): Promise<T> {
	let timerId: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<never>((_, reject) => {
		timerId = setTimeout(() => reject(e), ms)
	})
	try {
		return await Promise.race([promise, timeout])
	} finally {
		if (timerId !== undefined) clearTimeout(timerId)
	}
}

export function backoff(attempt: number): Promise<void> {
	return new Promise<void>((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30_000)))
}

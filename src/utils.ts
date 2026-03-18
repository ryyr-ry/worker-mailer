export * from "./encoding"
export * from "./queue"

export async function execTimeout<T>(promise: Promise<T>, ms: number, e: Error) {
	return Promise.race<T>([promise, new Promise((_, reject) => setTimeout(() => reject(e), ms))])
}

export function backoff(attempt: number): Promise<void> {
	return new Promise<void>((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30_000)))
}


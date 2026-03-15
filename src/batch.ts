import type { EmailOptions } from "./email"
import type { WorkerMailer } from "./mailer"
import type { SendResult } from "./result"

export type BatchResult = {
	success: boolean
	email: EmailOptions
	result?: SendResult
	error?: Error
}

export async function sendBatch(
	mailer: WorkerMailer,
	emails: EmailOptions[],
	options?: { continueOnError?: boolean },
): Promise<BatchResult[]> {
	const continueOnError = options?.continueOnError ?? true
	const results: BatchResult[] = []

	for (const email of emails) {
		try {
			const result = await mailer.send(email)
			results.push({ success: true, email, result })
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e))
			results.push({ success: false, email, error })
			if (!continueOnError) {
				break
			}
		}
	}

	return results
}

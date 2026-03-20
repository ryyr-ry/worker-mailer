import type { EmailOptions } from "./email/types"
import { ConfigurationError } from "./errors"
import type { Mailer } from "./mailer"
import type { SendResult } from "./result"

export type BatchResult = {
	success: boolean
	email: EmailOptions
	result?: SendResult
	error?: Error
}

export type BatchOptions = {
	continueOnError?: boolean
	concurrency?: number
}

export async function sendBatch(
	mailer: Mailer,
	emails: EmailOptions[],
	options?: BatchOptions,
): Promise<BatchResult[]> {
	const continueOnError = options?.continueOnError ?? true
	const concurrency = options?.concurrency ?? 1

	if (!Number.isInteger(concurrency) || concurrency < 0) {
		throw new ConfigurationError("[Batch] concurrency must be a non-negative integer")
	}

	if (concurrency <= 1) {
		return sendSequential(mailer, emails, continueOnError)
	}

	return sendConcurrent(mailer, emails, concurrency, continueOnError)
}

async function sendSequential(
	mailer: Mailer,
	emails: EmailOptions[],
	continueOnError: boolean,
): Promise<BatchResult[]> {
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

async function sendConcurrent(
	mailer: Mailer,
	emails: EmailOptions[],
	concurrency: number,
	continueOnError: boolean,
): Promise<BatchResult[]> {
	const results: BatchResult[] = new Array(emails.length)
	let aborted = false
	let index = 0

	async function worker() {
		while (index < emails.length && !aborted) {
			const currentIndex = index++
			const email = emails[currentIndex]
			try {
				const result = await mailer.send(email)
				results[currentIndex] = { success: true, email, result }
			} catch (e: unknown) {
				const error = e instanceof Error ? e : new Error(String(e))
				results[currentIndex] = { success: false, email, error }
				if (!continueOnError) {
					aborted = true
				}
			}
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, emails.length) }, () => worker())
	await Promise.all(workers)

	return results.filter((r) => r !== undefined)
}

import type { EmailOptions } from "./email/types"
import type { SendResult } from "./result"

export type SentEmail = {
	options: EmailOptions
	result: SendResult
	sentAt: Date
}

export function normalizeRecipients(
	recipients:
		| string
		| string[]
		| { name?: string; email: string }
		| { name?: string; email: string }[],
): string[] {
	if (typeof recipients === "string") return [recipients]
	if (Array.isArray(recipients)) {
		return recipients.map((recipient) =>
			typeof recipient === "string" ? recipient : recipient.email,
		)
	}
	return [recipients.email]
}

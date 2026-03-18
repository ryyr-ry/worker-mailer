import { Email } from "./email/email"
import type { EmailOptions } from "./email/types"

export type EmailPreview = {
	headers: Record<string, string>
	text?: string
	html?: string
	raw: string
}

export function previewEmail(options: EmailOptions): EmailPreview {
	const email = new Email(options)
	const raw = email.getRawMessage()
	return {
		headers: { ...email.headers },
		text: email.text,
		html: email.html,
		raw,
	}
}

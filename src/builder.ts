/**
 * Email builder API
 * Builds EmailOptions using method chaining
 */

import type {
	Attachment,
	CalendarEventPart,
	DsnOptions,
	EmailOptions,
	InlineAttachment,
	User,
} from "./email/types"
import { EmailValidationError } from "./errors"

type Recipient = string | User

export class MailBuilder {
	private opts: Partial<EmailOptions> = {}

	from(sender: Recipient): this {
		this.opts.from = sender
		return this
	}

	to(...recipients: Recipient[]): this {
		return this.setRecipients("to", recipients)
	}

	cc(...recipients: Recipient[]): this {
		return this.setRecipients("cc", recipients)
	}

	bcc(...recipients: Recipient[]): this {
		return this.setRecipients("bcc", recipients)
	}

	replyTo(address: Recipient): this {
		this.opts.reply = address
		return this
	}

	subject(subject: string): this {
		this.opts.subject = subject
		return this
	}

	text(text: string): this {
		this.opts.text = text
		return this
	}

	html(html: string): this {
		this.opts.html = html
		return this
	}

	header(name: string, value: string): this {
		this.opts.headers = { ...this.opts.headers, [name]: value }
		return this
	}

	headers(headers: Record<string, string>): this {
		this.opts.headers = { ...this.opts.headers, ...headers }
		return this
	}

	attach(attachment: Attachment): this {
		this.opts.attachments = [...(this.opts.attachments ?? []), attachment]
		return this
	}

	inlineAttach(attachment: InlineAttachment): this {
		this.opts.inlineAttachments = [...(this.opts.inlineAttachments ?? []), attachment]
		return this
	}

	calendarEvent(event: CalendarEventPart): this {
		this.opts.calendarEvent = event
		return this
	}

	dsn(options: DsnOptions): this {
		this.opts.dsnOverride = options
		return this
	}

	private setRecipients(field: "to" | "cc" | "bcc", recipients: Recipient[]): this {
		if (recipients.length === 0) {
			throw new EmailValidationError(`[MailBuilder] ${field} requires at least one recipient`)
		}
		this.opts[field] = recipients.length === 1 ? recipients[0] : (recipients as string[] | User[])
		return this
	}

	build(): EmailOptions {
		if (!this.opts.from) {
			throw new EmailValidationError("[MailBuilder] from is required")
		}
		if (!this.opts.to || (Array.isArray(this.opts.to) && this.opts.to.length === 0)) {
			throw new EmailValidationError("[MailBuilder] to is required")
		}
		if (!this.opts.subject) {
			throw new EmailValidationError("[MailBuilder] subject is required")
		}
		if (!this.opts.text && !this.opts.html) {
			throw new EmailValidationError("[MailBuilder] text or html is required")
		}
		return { ...this.opts } as EmailOptions
	}
}

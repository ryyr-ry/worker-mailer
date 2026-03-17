/**
 * メールビルダーAPI
 * メソッドチェーンでEmailOptionsを構築する
 */

import type {
	Attachment,
	CalendarEventPart,
	DsnOptions,
	EmailOptions,
	InlineAttachment,
	User,
} from "./email/types"

type Recipient = string | User

export class MailBuilder {
	private opts: Partial<EmailOptions> = {}

	from(sender: Recipient): this {
		this.opts.from = sender
		return this
	}

	to(...recipients: Recipient[]): this {
		this.opts.to = recipients.length === 1
			? recipients[0]
			: (recipients as string[] | User[])
		return this
	}

	cc(...recipients: Recipient[]): this {
		this.opts.cc = recipients.length === 1
			? recipients[0]
			: (recipients as string[] | User[])
		return this
	}

	bcc(...recipients: Recipient[]): this {
		this.opts.bcc = recipients.length === 1
			? recipients[0]
			: (recipients as string[] | User[])
		return this
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
		this.opts.inlineAttachments = [
			...(this.opts.inlineAttachments ?? []),
			attachment,
		]
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

	build(): EmailOptions {
		if (!this.opts.from) {
			throw new Error("from is required")
		}
		if (!this.opts.to) {
			throw new Error("to is required")
		}
		if (!this.opts.subject) {
			throw new Error("subject is required")
		}
		return { ...this.opts } as EmailOptions
	}
}

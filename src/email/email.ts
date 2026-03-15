import type { SendResult } from "../result"
import { validateEmail as checkEmail } from "../validate"
import { resolveHeaders } from "./header"
import { buildMimeMessage } from "./mime"
import type {
	Attachment,
	CalendarEventPart,
	DsnOptions,
	EmailOptions,
	InlineAttachment,
	User,
} from "./types"

export class Email {
	public readonly from: User
	public readonly to: User[]
	public readonly reply?: User
	public readonly cc?: User[]
	public readonly bcc?: User[]

	public readonly subject: string
	public readonly text?: string
	public readonly html?: string
	public readonly dsnOverride?: DsnOptions
	public readonly options: EmailOptions
	public readonly inlineAttachments?: InlineAttachment[]
	public readonly calendarEvent?: CalendarEventPart

	public readonly attachments?: Attachment[]

	public readonly headers: Record<string, string>

	public setSentResult!: (result: SendResult) => void
	public setSentError!: (e: unknown) => void

	public sentResult = new Promise<SendResult>((resolve, reject) => {
		this.setSentResult = resolve
		this.setSentError = reject
	})

	public readonly sent: Promise<void> = this.sentResult.then(() => {})

	constructor(options: EmailOptions) {
		this.options = options

		// Suppress unhandled rejections on both promise channels
		this.sentResult.catch(() => {})
		this.sent.catch(() => {})

		if (!options.text && !options.html) {
			throw new Error("At least one of text or html must be provided")
		}

		if (typeof options.from === "string") {
			this.from = { email: options.from }
		} else {
			this.from = options.from
		}
		if (typeof options.reply === "string") {
			this.reply = { email: options.reply }
		} else {
			this.reply = options.reply
		}
		this.to = Email.toUsers(options.to) ?? []
		this.cc = Email.toUsers(options.cc)
		this.bcc = Email.toUsers(options.bcc)

		this.subject = options.subject
		this.text = options.text
		this.html = options.html
		this.attachments = options.attachments
		this.inlineAttachments = options.inlineAttachments
		this.calendarEvent = options.calendarEvent
		this.dsnOverride = options.dsnOverride
		this.headers = options.headers ? { ...options.headers } : {}

		this.validateNoCRLF()
		this.validateEmailAddresses()
		this.validateAttachments()
		this.validateInlineAttachments()
		this.validateCalendarEvent()

		resolveHeaders({
			from: this.from,
			to: this.to,
			cc: this.cc,
			reply: this.reply,
			subject: this.subject,
			headers: this.headers,
		})
	}

	private static readonly CRLF_PATTERN = /[\r\n]/

	private validateNoCRLF() {
		if (Email.CRLF_PATTERN.test(this.subject)) {
			throw new Error("CRLF injection detected in subject")
		}
		this.validateUserNoCRLF(this.from, "from")
		if (this.to) for (const u of this.to) this.validateUserNoCRLF(u, "to")
		if (this.cc) for (const u of this.cc) this.validateUserNoCRLF(u, "cc")
		if (this.bcc) for (const u of this.bcc) this.validateUserNoCRLF(u, "bcc")
		if (this.reply) this.validateUserNoCRLF(this.reply, "reply")

		for (const [key, value] of Object.entries(this.headers)) {
			if (Email.CRLF_PATTERN.test(key) || Email.CRLF_PATTERN.test(value)) {
				throw new Error(`CRLF injection detected in header: ${key}`)
			}
		}
	}

	private validateUserNoCRLF(user: { name?: string; email: string }, field: string) {
		if (user.name && Email.CRLF_PATTERN.test(user.name)) {
			throw new Error(`CRLF injection detected in ${field} display name`)
		}
	}

	private validateEmailAddresses() {
		this.validateEmail(this.from.email, "from")
		for (const user of this.to) {
			this.validateEmail(user.email, "to")
		}
		if (this.cc) {
			for (const user of this.cc) {
				this.validateEmail(user.email, "cc")
			}
		}
		if (this.bcc) {
			for (const user of this.bcc) {
				this.validateEmail(user.email, "bcc")
			}
		}
		if (this.reply) {
			this.validateEmail(this.reply.email, "reply-to")
		}
	}

	private static readonly ANGLE_BRACKET_PATTERN = /[<>]/

	private validateEmail(email: string, field: string) {
		if (Email.ANGLE_BRACKET_PATTERN.test(email)) {
			throw new Error(`Invalid email address in ${field}: ${email}`)
		}
		const result = checkEmail(email)
		if (!result.valid) {
			throw new Error(`Invalid email address in ${field}: ${email}`)
		}
	}

	private static readonly UNSAFE_FILENAME_PATTERN = /[\r\n"]/

	private static readonly BASE64_PATTERN = /^[A-Za-z0-9+/\r\n]+=*$/

	private validateAttachments() {
		if (!this.attachments) return
		for (const attachment of this.attachments) {
			Email.validateAttachmentEntry(attachment)
		}
	}

	private static validateAttachmentEntry(attachment: Attachment | InlineAttachment) {
		if (Email.UNSAFE_FILENAME_PATTERN.test(attachment.filename)) {
			throw new Error(
				`Invalid attachment filename: ${attachment.filename.replaceAll(/[\r\n]/g, "?")}`,
			)
		}
		if (typeof attachment.content === "string" && !Email.BASE64_PATTERN.test(attachment.content)) {
			throw new Error(`Invalid base64 content in attachment: ${attachment.filename}`)
		}
	}

	private validateInlineAttachments() {
		if (!this.inlineAttachments) return
		if (!this.html) {
			throw new Error("Inline attachments require HTML content")
		}
		const cids = new Set<string>()
		for (const inline of this.inlineAttachments) {
			if (!inline.cid || inline.cid.length === 0) {
				throw new Error("Inline attachment CID must not be empty")
			}
			if (/[<>]/.test(inline.cid)) {
				throw new Error(`Inline attachment CID must not contain angle brackets: ${inline.cid}`)
			}
			if (/[\r\n]/.test(inline.cid)) {
				throw new Error("CRLF injection detected in inline attachment CID")
			}
			if (cids.has(inline.cid)) {
				throw new Error(`Duplicate inline attachment CID: ${inline.cid}`)
			}
			cids.add(inline.cid)
			Email.validateAttachmentEntry(inline)
		}
	}

	private validateCalendarEvent() {
		if (!this.calendarEvent) return
		if (!this.calendarEvent.content || this.calendarEvent.content.length === 0) {
			throw new Error("Calendar event content must not be empty")
		}
	}

	private static toUsers(user: string | string[] | User | User[] | undefined): User[] | undefined {
		if (!user) {
			return
		}
		if (typeof user === "string") {
			return [{ email: user }]
		}
		if (Array.isArray(user)) {
			return user.map((u) => {
				if (typeof u === "string") {
					return { email: u }
				}
				return u
			})
		}
		return [user]
	}

	public getRawMessage(): string {
		return buildMimeMessage({
			headers: this.headers,
			text: this.text,
			html: this.html,
			attachments: this.attachments,
			inlineAttachments: this.inlineAttachments,
			calendarEvent: this.calendarEvent,
		})
	}
}

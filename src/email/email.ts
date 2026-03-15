import type { SendResult } from "../result"
import { validateEmail as checkEmail } from "../validate"
import { buildMimeMessage, resolveHeaders } from "./mime"
import type { EmailOptions, User } from "./types"

export class Email {
	public readonly from: User
	public readonly to: User[]
	public readonly reply?: User
	public readonly cc?: User[]
	public readonly bcc?: User[]

	public readonly subject: string
	public readonly text?: string
	public readonly html?: string
	public readonly dsnOverride?: {
		envelopeId?: string
		RET?: {
			HEADERS?: boolean
			FULL?: boolean
		}
		NOTIFY?: {
			DELAY?: boolean
			FAILURE?: boolean
			SUCCESS?: boolean
		}
	}

	public readonly attachments?: {
		filename: string
		content: string | Uint8Array | ArrayBuffer
		mimeType?: string
	}[]

	public readonly headers: Record<string, string>

	public setSentResult!: (result: SendResult) => void
	public setSentError!: (e: unknown) => void

	public sentResult = new Promise<SendResult>((resolve, reject) => {
		this.setSentResult = resolve
		this.setSentError = reject
	})

	public readonly sent: Promise<void> = this.sentResult.then(() => {})

	public setSent(): void {
		this.setSentResult({
			messageId: this.headers["Message-ID"] ?? "",
			accepted: [],
			rejected: [],
			responseTime: 0,
			response: "",
		})
	}

	constructor(options: EmailOptions) {
		// sentResult が主要なエラーチャネルだが、sent のみ使用されるケースもあるため
		// 両方の未処理拒否を抑制
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
		this.dsnOverride = options.dsnOverride
		this.headers = options.headers || {}

		this.validateNoCRLF()
		this.validateEmailAddresses()
		this.validateAttachments()
	}

	private static readonly CRLF_PATTERN = /[\r\n]/

	private validateNoCRLF() {
		if (Email.CRLF_PATTERN.test(this.subject)) {
			throw new Error("CRLF injection detected in subject")
		}
		for (const [key, value] of Object.entries(this.headers)) {
			if (Email.CRLF_PATTERN.test(key) || Email.CRLF_PATTERN.test(value)) {
				throw new Error(`CRLF injection detected in header: ${key}`)
			}
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
			if (Email.UNSAFE_FILENAME_PATTERN.test(attachment.filename)) {
				throw new Error(
					`Invalid attachment filename: ${attachment.filename.replaceAll(/[\r\n]/g, "?")}`,
				)
			}
			if (
				typeof attachment.content === "string" &&
				!Email.BASE64_PATTERN.test(attachment.content)
			) {
				throw new Error(`Invalid base64 content in attachment: ${attachment.filename}`)
			}
		}
	}

	private static toUsers(user: string | string[] | User | User[] | undefined): User[] | undefined {
		if (!user) {
			return
		}
		if (typeof user === "string") {
			return [{ email: user }]
		} else if (Array.isArray(user)) {
			return user.map((user) => {
				if (typeof user === "string") {
					return { email: user }
				}
				return user
			})
		} else {
			return [user]
		}
	}

	public getEmailData() {
		resolveHeaders({
			from: this.from,
			to: this.to,
			cc: this.cc,
			reply: this.reply,
			subject: this.subject,
			headers: this.headers,
		})

		return buildMimeMessage({
			headers: this.headers,
			text: this.text,
			html: this.html,
			attachments: this.attachments,
		})
	}
}

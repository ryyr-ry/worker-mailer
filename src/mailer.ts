import { connect } from "cloudflare:sockets"
import { Email, type EmailOptions } from "./email"
import Logger, { type LogLevel } from "./logger"
import { BlockingQueue, decode, encode, execTimeout, toBase64 } from "./utils"

export type AuthType = "plain" | "login" | "cram-md5"
export type Credentials = {
	username: string
	password: string
}
export type WorkerMailerOptions = {
	host: string
	port: number
	secure?: boolean
	startTls?: boolean
	credentials?: Credentials
	authType?: AuthType | AuthType[]
	logLevel?: LogLevel
	dsn?:
		| {
				RET?:
					| {
							HEADERS?: boolean
							FULL?: boolean
					  }
					| undefined
				NOTIFY?:
					| {
							DELAY?: boolean
							FAILURE?: boolean
							SUCCESS?: boolean
					  }
					| undefined
		  }
		| undefined
	socketTimeoutMs?: number
	responseTimeoutMs?: number
	ehloHostname?: string
	maxRetries?: number
	onError?: (error: Error) => void
}

export class WorkerMailer {
	private socket: Socket

	private readonly host: string
	private readonly port: number
	private readonly secure: boolean
	private readonly startTls: boolean
	private readonly authType: AuthType[]
	private readonly credentials?: Credentials

	private readonly socketTimeoutMs: number
	private readonly responseTimeoutMs: number
	private readonly ehloHostname: string
	private readonly maxRetries: number
	private readonly onError?: (error: Error) => void

	private reader: ReadableStreamDefaultReader<Uint8Array>
	private writer: WritableStreamDefaultWriter<Uint8Array>

	private readonly logger: Logger

	private readonly dsn:
		| {
				envelopeId?: string | undefined
				RET?:
					| {
							HEADERS?: boolean
							FULL?: boolean
					  }
					| undefined
				NOTIFY?:
					| {
							DELAY?: boolean
							FAILURE?: boolean
							SUCCESS?: boolean
					  }
					| undefined
		  }
		| undefined

	private active = false

	private emailSending: Email | null = null
	private emailToBeSent = new BlockingQueue<Email>()

	/** SMTP server capabilities **/
	private supportsDSN = false
	private allowAuth = false
	private authTypeSupported: AuthType[] = []
	private supportsStartTls = false

	private constructor(options: WorkerMailerOptions) {
		this.port = options.port
		this.host = options.host
		this.secure = !!options.secure
		if (Array.isArray(options.authType)) {
			this.authType = options.authType
		} else if (typeof options.authType === "string") {
			this.authType = [options.authType]
		} else {
			this.authType = []
		}
		this.startTls = options.startTls === undefined ? true : options.startTls
		this.credentials = options.credentials
		this.dsn = options.dsn || {}

		this.socketTimeoutMs = options.socketTimeoutMs || 60_000
		this.responseTimeoutMs = options.responseTimeoutMs || 30_000
		this.ehloHostname = options.ehloHostname || this.host
		this.maxRetries = options.maxRetries ?? 3
		this.onError = options.onError
		this.socket = connect(
			{
				hostname: this.host,
				port: this.port,
			},
			{
				secureTransport: this.secure ? "on" : this.startTls ? "starttls" : "off",
				allowHalfOpen: false,
			},
		)
		this.reader = this.socket.readable.getReader()
		this.writer = this.socket.writable.getWriter()

		this.logger = new Logger(options.logLevel, `[WorkerMailer:${this.host}:${this.port}]`)
	}

	static async connect(options: WorkerMailerOptions): Promise<WorkerMailer> {
		const mailer = new WorkerMailer(options)
		await mailer.initializeSmtpSession()
		mailer.start().catch((error: unknown) => {
			const normalizedError = error instanceof Error ? error : new Error(String(error))
			if (mailer.onError) {
				mailer.onError(normalizedError)
			} else {
				console.error(normalizedError)
			}
		})
		return mailer
	}

	public send(options: EmailOptions): Promise<void> {
		if (this.emailToBeSent.closed) {
			return Promise.reject(new Error("[WorkerMailer] Send failed: mailer is closed"))
		}
		const email = new Email(options)
		this.emailToBeSent.enqueue(email)
		return email.sent
	}

	static async send(options: WorkerMailerOptions, email: EmailOptions): Promise<void> {
		const mailer = await WorkerMailer.connect(options)
		await mailer.send(email)
		await mailer.close()
	}

	private async readTimeout(): Promise<string> {
		return execTimeout(
			this.read(),
			this.responseTimeoutMs,
			new Error("[WorkerMailer] Connection timeout: waiting for SMTP server response"),
		)
	}

	private async read(): Promise<string> {
		let response = ""
		while (true) {
			const { value, done } = await this.reader.read()
			if (done) {
				throw new Error(
					"[WorkerMailer] Connection closed: SMTP server closed the connection unexpectedly",
				)
			}
			if (!value) {
				continue
			}
			const data = decode(value).toString()
			this.logger.debug(`SMTP server response:\n${data}`)
			response = response + data
			if (!response.endsWith("\n")) {
				continue
			}
			const lines = response.split(/\r?\n/)
			const lastLine = lines[lines.length - 2]
			if (/^\d+-/.test(lastLine)) {
				continue
			}
			return response
		}
	}

	private async writeLine(line: string) {
		if (/[\r\n]/.test(line)) {
			throw new Error("[WorkerMailer] Security error: CRLF injection detected in SMTP command")
		}
		await this.write(`${line}\r\n`)
	}

	private async write(data: string) {
		this.logger.debug(`Write to socket:\n${data}`)
		await this.writer.write(encode(data))
	}

	private async initializeSmtpSession() {
		await this.waitForSocketConnected()
		await this.greet()
		await this.ehlo()

		// Handle STARTTLS if needed
		if (this.startTls && !this.secure && this.supportsStartTls) {
			await this.tls()
			// Re-issue EHLO after STARTTLS as required by RFC 3207
			await this.ehlo()
		}

		await this.auth()
		this.active = true
	}

	private async start() {
		while (this.active) {
			let email: Email
			try {
				email = await this.emailToBeSent.dequeue()
			} catch (_: unknown) {
				break
			}
			this.emailSending = email
			let sent = false
			for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
				try {
					await this.mail()
					await this.rcpt()
					await this.data()
					await this.body()
					this.emailSending.setSent()
					sent = true
					break
				} catch (e: unknown) {
					const message = e instanceof Error ? e.message : String(e)
					this.logger.error(
						`[WorkerMailer] Send failed: ${message} (attempt ${attempt + 1}/${this.maxRetries + 1})`,
					)
					if (!this.active) {
						this.emailSending.setSentError(e)
						return
					}
					try {
						await this.rset()
					} catch (rsetError: unknown) {
						if (attempt >= this.maxRetries) {
							this.emailSending.setSentError(e)
							const fatalError =
								rsetError instanceof Error ? rsetError : new Error(String(rsetError))
							await this.close(fatalError)
							this.reportFatalError(fatalError)
							return
						}
						// RSET 失敗でもリトライ回数が残っていれば指数バックオフ後に再試行
					}
					if (attempt < this.maxRetries) {
						const delayMs = Math.min(1000 * 2 ** attempt, 30_000)
						await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
					}
				}
			}
			if (!sent && this.active) {
				this.emailSending.setSentError(
					new Error(`[WorkerMailer] Send failed: max retries (${this.maxRetries}) exceeded`),
				)
			}
			this.emailSending = null
		}
	}

	public async close(error?: Error) {
		this.active = false
		this.logger.info("[WorkerMailer] Closing connection", error?.message || "")
		this.emailSending?.setSentError?.(error || new Error("[WorkerMailer] Mailer is shutting down"))

		const shutdownError = error || new Error("[WorkerMailer] Mailer is shutting down")
		while (this.emailToBeSent.length > 0) {
			const email = await this.emailToBeSent.dequeue()
			email.setSentError(shutdownError)
		}

		this.emailToBeSent.close()

		try {
			await this.writeLine("QUIT")
			await this.readTimeout()
			this.socket.close().catch(() => this.logger.error("[WorkerMailer] Failed to close socket"))
		} catch (_ignore) {
			// ソケットが既に閉じている可能性
		}
	}

	private reportFatalError(error: Error): void {
		if (this.onError) {
			this.onError(error)
		} else {
			console.error(error)
		}
	}

	private async waitForSocketConnected() {
		this.logger.info("[WorkerMailer] Connecting to SMTP server")
		await execTimeout(
			this.socket.opened,
			this.socketTimeoutMs,
			new Error("[WorkerMailer] Connection timeout: socket connection timed out"),
		)
		this.logger.info("[WorkerMailer] SMTP server connected")
	}

	private async greet() {
		const response = await this.readTimeout()
		if (!response.startsWith("220")) {
			throw new Error(
				`[WorkerMailer] Connection failed: unexpected greeting from SMTP server: ${response}`,
			)
		}
	}

	private async ehlo() {
		await this.writeLine(`EHLO ${this.ehloHostname}`)
		const response = await this.readTimeout()
		if (response.startsWith("421")) {
			throw new Error(`[WorkerMailer] EHLO failed: ${response}`)
		}
		if (!response.startsWith("2")) {
			await this.helo()
			return
		}
		this.parseCapabilities(response)
	}

	private async helo() {
		await this.writeLine(`HELO ${this.ehloHostname}`)
		const response = await this.readTimeout()
		if (response.startsWith("2")) {
			return
		}
		throw new Error(`[WorkerMailer] HELO failed: ${response}`)
	}

	private async tls() {
		await this.writeLine("STARTTLS")
		const response = await this.readTimeout()
		if (!response.startsWith("220")) {
			throw new Error(`[WorkerMailer] STARTTLS failed: ${response}`)
		}

		// Upgrade the socket to TLS
		this.reader.releaseLock()
		this.writer.releaseLock()
		this.socket = this.socket.startTls()
		this.reader = this.socket.readable.getReader()
		this.writer = this.socket.writable.getWriter()
	}

	private parseCapabilities(response: string) {
		if (/[ -]AUTH\b/i.test(response)) {
			this.allowAuth = true
		}
		if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)PLAIN/i.test(response)) {
			this.authTypeSupported.push("plain")
		}
		if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)LOGIN/i.test(response)) {
			this.authTypeSupported.push("login")
		}
		if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)CRAM-MD5/i.test(response)) {
			this.authTypeSupported.push("cram-md5")
		}
		if (/[ -]STARTTLS\b/i.test(response)) {
			this.supportsStartTls = true
		}
		if (/[ -]DSN\b/i.test(response)) {
			this.supportsDSN = true
		}
	}

	private async auth() {
		if (!this.allowAuth) {
			return
		}
		if (!this.credentials) {
			throw new Error("[WorkerMailer] Authentication required but no credentials provided")
		}
		if (this.authTypeSupported.includes("plain") && this.authType.includes("plain")) {
			await this.authWithPlain()
		} else if (this.authTypeSupported.includes("login") && this.authType.includes("login")) {
			await this.authWithLogin()
		} else if (this.authTypeSupported.includes("cram-md5") && this.authType.includes("cram-md5")) {
			await this.authWithCramMD5()
		} else {
			throw new Error("[WorkerMailer] No supported authentication method found")
		}
	}

	private async authWithPlain() {
		const userPassBase64 = toBase64(
			`\u0000${this.credentials?.username}\u0000${this.credentials?.password}`,
		)
		await this.writeLine(`AUTH PLAIN ${userPassBase64}`)
		const authResult = await this.readTimeout()
		if (!authResult.startsWith("2")) {
			throw new Error(`[WorkerMailer] PLAIN authentication failed: ${authResult}`)
		}
	}

	private async authWithLogin() {
		await this.writeLine(`AUTH LOGIN`)
		const startLoginResponse = await this.readTimeout()
		if (!startLoginResponse.startsWith("3")) {
			throw new Error(`[WorkerMailer] LOGIN authentication failed: ${startLoginResponse}`)
		}

		const usernameBase64 = toBase64(this.credentials?.username ?? "")
		await this.writeLine(usernameBase64)
		const userResponse = await this.readTimeout()
		if (!userResponse.startsWith("3")) {
			throw new Error(`[WorkerMailer] LOGIN authentication failed: ${userResponse}`)
		}

		const passwordBase64 = toBase64(this.credentials?.password ?? "")
		await this.writeLine(passwordBase64)
		const authResult = await this.readTimeout()
		if (!authResult.startsWith("2")) {
			throw new Error(`[WorkerMailer] LOGIN authentication failed: ${authResult}`)
		}
	}

	private async authWithCramMD5() {
		this.logger.warn(
			"CRAM-MD5 uses HMAC-MD5 which is cryptographically deprecated. Consider using PLAIN or LOGIN over TLS instead.",
		)
		await this.writeLine("AUTH CRAM-MD5")
		const challengeResponse = await this.readTimeout()
		const challengeWithBase64Encoded = challengeResponse
			.trim()
			.match(/^334\s+(.+)$/)
			?.pop()
		if (!challengeWithBase64Encoded) {
			throw new Error(
				`[WorkerMailer] CRAM-MD5 authentication failed: invalid challenge: ${challengeResponse}`,
			)
		}

		// solve challenge
		const challenge = atob(challengeWithBase64Encoded)

		// Import password as key
		const keyData = encode(this.credentials?.password ?? "")
		const key = await crypto.subtle.importKey(
			"raw",
			keyData,
			{ name: "HMAC", hash: "MD5" },
			false,
			["sign"],
		)

		// Sign the challenge
		const challengeData = encode(challenge)
		const signature = await crypto.subtle.sign("HMAC", key, challengeData)

		// Convert to hex
		const challengeSolved = Array.from(new Uint8Array(signature))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")

		await this.writeLine(toBase64(`${this.credentials?.username} ${challengeSolved}`))
		const authResult = await this.readTimeout()
		if (!authResult.startsWith("2")) {
			throw new Error(`[WorkerMailer] CRAM-MD5 authentication failed: ${authResult}`)
		}
	}

	private async mail() {
		let message = `MAIL FROM: <${this.emailSending?.from.email}>`
		if (this.supportsDSN) {
			message += ` ${this.retBuilder()}`
			if (this.emailSending?.dsnOverride?.envelopeId) {
				message += ` ENVID=${this.emailSending?.dsnOverride?.envelopeId}`
			}
		}

		await this.writeLine(message)
		const response = await this.readTimeout()
		if (!response.startsWith("2")) {
			throw new Error(`[WorkerMailer] MAIL FROM failed: ${message} ${response}`)
		}
	}

	private async rcpt() {
		const allRecipients = [
			...(this.emailSending?.to ?? []),
			...(this.emailSending?.cc ?? []),
			...(this.emailSending?.bcc ?? []),
		]

		for (const user of allRecipients) {
			let message = `RCPT TO: <${user.email}>`
			if (this.supportsDSN) {
				message += this.notificationBuilder()
			}
			await this.writeLine(message)
			const rcptResponse = await this.readTimeout()
			if (!rcptResponse.startsWith("2")) {
				throw new Error(`[WorkerMailer] RCPT TO failed: ${message} ${rcptResponse}`)
			}
		}
	}

	private async data() {
		await this.writeLine("DATA")
		const response = await this.readTimeout()
		if (!response.startsWith("3")) {
			throw new Error(`[WorkerMailer] DATA command failed: ${response}`)
		}
	}

	private async body() {
		await this.write(this.emailSending?.getEmailData())
		const response = await this.readTimeout()
		if (!response.startsWith("2")) {
			throw new Error(`[WorkerMailer] Send body failed: ${response}`)
		}
	}

	private async rset() {
		await this.writeLine("RSET")
		const response = await this.readTimeout()
		if (!response.startsWith("2")) {
			throw new Error(`[WorkerMailer] RSET failed: ${response}`)
		}
	}

	private notificationBuilder() {
		const notifications: string[] = []
		if (
			this.emailSending?.dsnOverride?.NOTIFY?.SUCCESS ||
			(!this.emailSending?.dsnOverride?.NOTIFY && this.dsn?.NOTIFY?.SUCCESS)
		) {
			notifications.push("SUCCESS")
		}
		if (
			this.emailSending?.dsnOverride?.NOTIFY?.FAILURE ||
			(!this.emailSending?.dsnOverride?.NOTIFY && this.dsn?.NOTIFY?.FAILURE)
		) {
			notifications.push("FAILURE")
		}
		if (
			this.emailSending?.dsnOverride?.NOTIFY?.DELAY ||
			(!this.emailSending?.dsnOverride?.NOTIFY && this.dsn?.NOTIFY?.DELAY)
		) {
			notifications.push("DELAY")
		}
		return notifications.length > 0 ? ` NOTIFY=${notifications.join(",")}` : " NOTIFY=NEVER"
	}

	private retBuilder() {
		const ret: string[] = []
		if (
			this.emailSending?.dsnOverride?.RET?.HEADERS ||
			(!this.emailSending?.dsnOverride?.RET && this.dsn?.RET?.HEADERS)
		) {
			ret.push("HDRS")
		}
		if (
			this.emailSending?.dsnOverride?.RET?.FULL ||
			(!this.emailSending?.dsnOverride?.RET && this.dsn?.RET?.FULL)
		) {
			ret.push("FULL")
		}
		return ret.length > 0 ? `RET=${ret.join(",")}` : ""
	}
}

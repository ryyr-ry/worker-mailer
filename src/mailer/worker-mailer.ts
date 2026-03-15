import { connect } from "cloudflare:sockets"
import { Email } from "../email/email"
import { applyDotStuffing } from "../email/mime"
import type { EmailOptions } from "../email/types"
import Logger from "../logger"
import type { SendResult } from "../result"
import { BlockingQueue } from "../utils"
import { authenticate } from "./auth"
import { dataCommand, mailFrom, rcptTo, rset, sendBody } from "./commands"
import { inferSecurity, validatePortSecurity } from "./config"
import { ehlo, greet, startTls } from "./handshake"
import { SmtpTransport } from "./transport"
import type { AuthType, Credentials, SmtpCapabilities, WorkerMailerOptions } from "./types"

function backoff(attempt: number): Promise<void> {
	return new Promise<void>((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30_000)))
}

export class WorkerMailer {
	private transport: SmtpTransport
	private capabilities: SmtpCapabilities = {
		supportsDSN: false,
		allowAuth: false,
		authTypeSupported: [],
		supportsStartTls: false,
	}
	private readonly host: string
	private readonly port: number
	private readonly secure: boolean
	private readonly startTlsEnabled: boolean
	private readonly authType: AuthType[]
	private readonly credentials?: Credentials
	private readonly socketTimeoutMs: number
	private readonly responseTimeoutMs: number
	private readonly ehloHostname: string
	private readonly maxRetries: number
	private readonly autoReconnect: boolean
	private readonly onError?: (error: Error) => void
	private readonly logger: Logger
	private readonly dsn: WorkerMailerOptions["dsn"]
	private active = false
	private emailSending: Email | null = null
	private emailToBeSent = new BlockingQueue<Email>()
	private constructor(options: WorkerMailerOptions) {
		this.port = options.port
		this.host = options.host
		const { secure, startTls } = inferSecurity(options)
		this.secure = secure
		this.startTlsEnabled = startTls
		validatePortSecurity(this.port, this.secure, this.startTlsEnabled)
		this.authType = options.authType ?? []
		if (options.username !== undefined && options.password !== undefined) {
			this.credentials = { username: options.username, password: options.password }
		} else if (options.username !== undefined || options.password !== undefined) {
			throw new Error("[WorkerMailer] Both username and password must be provided together")
		}
		this.dsn = options.dsn || {}
		this.socketTimeoutMs = options.socketTimeoutMs || 60_000
		this.responseTimeoutMs = options.responseTimeoutMs || 30_000
		this.ehloHostname = options.ehloHostname || this.host
		this.maxRetries = options.maxRetries ?? 3
		this.autoReconnect = options.autoReconnect ?? false
		this.onError = options.onError
		this.logger = new Logger(options.logLevel, `[WorkerMailer:${this.host}:${this.port}]`)
		this.transport = this.createTransport()
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
	public send(options: EmailOptions): Promise<SendResult> {
		if (this.emailToBeSent.closed) {
			return Promise.reject(new Error("[WorkerMailer] Send failed: mailer is closed"))
		}
		const email = new Email(options)
		this.emailToBeSent.enqueue(email)
		return email.sentResult
	}

	private async initializeSmtpSession(): Promise<void> {
		this.logger.info("[WorkerMailer] Connecting to SMTP server")
		await this.transport.waitForOpen(this.socketTimeoutMs)
		this.logger.info("[WorkerMailer] SMTP server connected")
		await greet(this.transport)
		this.capabilities = await ehlo(this.transport, this.ehloHostname)
		if (this.startTlsEnabled && !this.secure && this.capabilities.supportsStartTls) {
			await startTls(this.transport)
			this.capabilities = await ehlo(this.transport, this.ehloHostname)
		}
		if (this.credentials) {
			await authenticate(
				this.transport,
				this.credentials,
				this.capabilities,
				this.authType,
				this.logger,
			)
		} else if (this.capabilities.allowAuth) {
			throw new Error("[WorkerMailer] Authentication required but no credentials provided")
		}
		this.active = true
	}
	private async start(): Promise<void> {
		while (this.active) {
			let email: Email
			try {
				email = await this.emailToBeSent.dequeue()
			} catch (_: unknown) {
				break
			}
			this.emailSending = email
			await this.processEmailWithRetry()
			this.emailSending = null
		}
	}
	private async processEmailWithRetry(): Promise<void> {
		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			try {
				await this.executeSend()
				return
			} catch (e: unknown) {
				const shouldReturn = await this.handleSendFailure(e, attempt)
				if (shouldReturn) return
			}
		}
		if (this.active && this.emailSending) {
			this.emailSending.setSentError(
				new Error(`[WorkerMailer] Send failed: max retries (${this.maxRetries}) exceeded`),
			)
		}
	}

	private async executeSend(): Promise<void> {
		if (!this.emailSending) return
		const startTime = Date.now()
		const email = this.emailSending
		const allRecipients = [...(email.to ?? []), ...(email.cc ?? []), ...(email.bcc ?? [])]
		await mailFrom(this.transport, email.from.email, this.capabilities, this.dsn, email.dsnOverride)
		await rcptTo(this.transport, allRecipients, this.capabilities, this.dsn, email.dsnOverride)
		await dataCommand(this.transport)
		const smtpData = `${applyDotStuffing(email.getRawMessage())}\r\n.\r\n`
		const bodyResponse = await sendBody(this.transport, smtpData)
		email.setSentResult({
			messageId: email.headers["Message-ID"] ?? "",
			accepted: allRecipients.map((u) => u.email),
			rejected: [],
			responseTime: Date.now() - startTime,
			response: bodyResponse.trim(),
		})
	}
	private async handleSendFailure(e: unknown, attempt: number): Promise<boolean> {
		if (!this.emailSending) return true
		const message = e instanceof Error ? e.message : String(e)
		this.logger.error(
			`[WorkerMailer] Send failed: ${message} (attempt ${attempt + 1}/${this.maxRetries + 1})`,
		)
		if (!this.active) {
			this.emailSending.setSentError(e)
			return true
		}
		try {
			await rset(this.transport)
		} catch (rsetError: unknown) {
			if (this.autoReconnect && attempt < this.maxRetries && (await this.tryReconnect())) {
				await backoff(attempt)
				return false
			}
			if (attempt >= this.maxRetries) {
				this.emailSending.setSentError(e)
				const fatal = rsetError instanceof Error ? rsetError : new Error(String(rsetError))
				await this.close(fatal)
				this.reportFatalError(fatal)
				return true
			}
		}
		if (attempt < this.maxRetries) {
			await backoff(attempt)
		}
		return false
	}
	private createTransport(): SmtpTransport {
		const mode = this.secure ? "on" : this.startTlsEnabled ? "starttls" : "off"
		const socket = connect(
			{ hostname: this.host, port: this.port },
			{ secureTransport: mode, allowHalfOpen: false },
		)
		return new SmtpTransport(socket, this.logger, this.responseTimeoutMs)
	}

	private async tryReconnect(): Promise<boolean> {
		const maxAttempts = 3
		for (let i = 0; i < maxAttempts; i++) {
			try {
				this.logger.info(`[WorkerMailer] Reconnecting (attempt ${i + 1}/${maxAttempts})`)
				this.transport.safeClose()
				this.transport = this.createTransport()
				this.capabilities = {
					supportsDSN: false,
					allowAuth: false,
					authTypeSupported: [],
					supportsStartTls: false,
				}
				await this.initializeSmtpSession()
				this.logger.info("[WorkerMailer] Reconnection successful")
				return true
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err)
				this.logger.error(`[WorkerMailer] Reconnect failed: ${msg}`)
				if (i < maxAttempts - 1) await backoff(i)
			}
		}
		return false
	}
	public async close(error?: Error): Promise<void> {
		this.active = false
		this.logger.info("[WorkerMailer] Closing connection", error?.message || "")
		const shutdownError = error || new Error("[WorkerMailer] Mailer is shutting down")
		this.emailSending?.setSentError?.(shutdownError)
		while (this.emailToBeSent.length > 0) {
			const email = await this.emailToBeSent.dequeue()
			email.setSentError(shutdownError)
		}
		this.emailToBeSent.close()
		try {
			await this.transport.quit()
		} catch (_) {
			/* Socket may already be closed */
		}
	}
	async [Symbol.asyncDispose](): Promise<void> {
		await this.close()
	}
	private reportFatalError(error: Error): void {
		if (this.onError) {
			this.onError(error)
		} else {
			console.error(error)
		}
	}
}

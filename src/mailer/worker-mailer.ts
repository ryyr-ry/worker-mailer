import { connect } from "cloudflare:sockets"
import { Email, type EmailOptions } from "../email"
import Logger from "../logger"
import type { SendResult } from "../result"
import { BlockingQueue } from "../utils"
import { authenticate } from "./auth"
import { dataCommand, mailFrom, rcptTo, rset, sendBody } from "./commands"
import { ehlo, greet, startTls } from "./handshake"
import { SmtpTransport } from "./transport"
import type {
	AuthType,
	Credentials,
	DsnOptions,
	SmtpCapabilities,
	WorkerMailerOptions,
} from "./types"

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
		this.secure = !!options.secure
		if (Array.isArray(options.authType)) {
			this.authType = options.authType
		} else if (typeof options.authType === "string") {
			this.authType = [options.authType]
		} else {
			this.authType = []
		}
		this.startTlsEnabled = options.startTls === undefined ? true : options.startTls
		this.credentials = options.credentials
		this.dsn = options.dsn || {}

		this.socketTimeoutMs = options.socketTimeoutMs || 60_000
		this.responseTimeoutMs = options.responseTimeoutMs || 30_000
		this.ehloHostname = options.ehloHostname || this.host
		this.maxRetries = options.maxRetries ?? 3
		this.autoReconnect = options.autoReconnect ?? false
		this.onError = options.onError

		this.logger = new Logger(options.logLevel, `[WorkerMailer:${this.host}:${this.port}]`)

		const socket = connect(
			{ hostname: this.host, port: this.port },
			{
				secureTransport: this.secure ? "on" : this.startTlsEnabled ? "starttls" : "off",
				allowHalfOpen: false,
			},
		)
		this.transport = new SmtpTransport(socket, this.logger, this.responseTimeoutMs)
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

	static async send(options: WorkerMailerOptions, email: EmailOptions): Promise<SendResult> {
		const mailer = await WorkerMailer.connect(options)
		const result = await mailer.send(email)
		await mailer.close()
		return result
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
			let sent = false
			for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
				try {
					const startTime = Date.now()

					const allRecipients = [
						...(this.emailSending.to ?? []),
						...(this.emailSending.cc ?? []),
						...(this.emailSending.bcc ?? []),
					]

					await mailFrom(
						this.transport,
						this.emailSending.from.email,
						this.capabilities,
						this.dsn as DsnOptions | undefined,
						this.emailSending.dsnOverride as DsnOptions | undefined,
					)
					await rcptTo(
						this.transport,
						allRecipients,
						this.capabilities,
						this.dsn as DsnOptions | undefined,
						this.emailSending.dsnOverride as DsnOptions | undefined,
					)
					await dataCommand(this.transport)
					const bodyResponse = await sendBody(this.transport, this.emailSending.getEmailData())
					const responseTime = Date.now() - startTime

					this.emailSending.setSentResult({
						messageId: this.emailSending.headers["Message-ID"] ?? "",
						accepted: allRecipients.map((u) => u.email),
						rejected: [],
						responseTime,
						response: bodyResponse.trim(),
					})
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
						await rset(this.transport)
					} catch (rsetError: unknown) {
						if (this.autoReconnect && attempt < this.maxRetries) {
							const reconnected = await this.tryReconnect()
							if (reconnected) {
								const delayMs = Math.min(1000 * 2 ** attempt, 30_000)
								await new Promise<void>((r) => setTimeout(r, delayMs))
								continue
							}
						}
						if (attempt >= this.maxRetries) {
							this.emailSending.setSentError(e)
							const fatalError =
								rsetError instanceof Error ? rsetError : new Error(String(rsetError))
							await this.close(fatalError)
							this.reportFatalError(fatalError)
							return
						}
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

	private async tryReconnect(): Promise<boolean> {
		const maxReconnectAttempts = 3
		for (let i = 0; i < maxReconnectAttempts; i++) {
			try {
				this.logger.info(`[WorkerMailer] Reconnecting (attempt ${i + 1}/${maxReconnectAttempts})`)

				this.transport.safeClose()

				const newSocket = connect(
					{ hostname: this.host, port: this.port },
					{
						secureTransport: this.secure ? "on" : this.startTlsEnabled ? "starttls" : "off",
						allowHalfOpen: false,
					},
				)
				this.transport = new SmtpTransport(newSocket, this.logger, this.responseTimeoutMs)

				this.capabilities = {
					supportsDSN: false,
					allowAuth: false,
					authTypeSupported: [],
					supportsStartTls: false,
				}

				await this.initializeSmtpSession()
				this.logger.info("[WorkerMailer] Reconnection successful")
				return true
			} catch (reconnectError: unknown) {
				const msg =
					reconnectError instanceof Error ? reconnectError.message : String(reconnectError)
				this.logger.error(`[WorkerMailer] Reconnect failed: ${msg}`)
				if (i < maxReconnectAttempts - 1) {
					const backoffMs = Math.min(1000 * 2 ** i, 30_000)
					await new Promise<void>((r) => setTimeout(r, backoffMs))
				}
			}
		}
		return false
	}

	public async close(error?: Error): Promise<void> {
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
			await this.transport.quit()
		} catch (_ignore) {
			// ソケットが既に閉じている可能性
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

import { connect } from "cloudflare:sockets"
import { type DkimOptions, resolveDkimKey, signDkim } from "../dkim"
import { Email } from "../email/email"
import { applyDotStuffing } from "../email/mime"
import type { EmailOptions } from "../email/types"
import { ConfigurationError, CrlfInjectionError, SmtpConnectionError } from "../errors"
import Logger from "../logger"
import type { SendResult } from "../result"
import { BlockingQueue, backoff } from "../utils"
import { dataCommand, hasNonAscii, mailFrom, noop, rcptTo, rset, sendBody } from "./commands"
import { inferSecurity, validatePortSecurity } from "./config"
import { initializeSession } from "./session"
import { SmtpTransport } from "./transport"
import {
	type AuthType,
	type Credentials,
	emptyCapabilities,
	type Mailer,
	SendCancelledError,
	type SendHooks,
	type SmtpCapabilities,
	type WorkerMailerOptions,
} from "./types"

export class WorkerMailer implements Mailer {
	private transport: SmtpTransport
	private capabilities: SmtpCapabilities = emptyCapabilities
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
	private readonly hooks?: SendHooks
	private readonly logger: Logger
	private readonly dsn: WorkerMailerOptions["dsn"]
	private readonly dkimOptions?: DkimOptions
	private dkimKey?: CryptoKey
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
		const { username, password } = options
		if (username !== undefined && password !== undefined) {
			this.credentials = { username, password }
		} else if (username !== undefined || password !== undefined) {
			throw new ConfigurationError(
				"[WorkerMailer] Both username and password must be provided together",
			)
		}
		this.dsn = options.dsn || {}
		this.socketTimeoutMs = options.socketTimeoutMs || 60_000
		this.responseTimeoutMs = options.responseTimeoutMs || 30_000
		this.ehloHostname = options.ehloHostname || this.host
		this.maxRetries = options.maxRetries ?? 3
		this.autoReconnect = options.autoReconnect ?? false
		this.hooks = options.hooks
		this.dkimOptions = options.dkim
		this.logger = new Logger(options.logLevel, `[WorkerMailer:${this.host}:${this.port}]`)
		this.transport = this.createTransport()
	}

	static async connect(options: WorkerMailerOptions): Promise<WorkerMailer> {
		const mailer = new WorkerMailer(options)
		await mailer.initializeSmtpSession()
		mailer.hooks?.onConnected?.({ host: mailer.host, port: mailer.port })
		mailer
			.start()
			.catch((e) => mailer.reportFatalError(e instanceof Error ? e : new Error(String(e))))
		return mailer
	}
	public async send(options: EmailOptions): Promise<SendResult> {
		if (this.emailToBeSent.closed) {
			throw new SmtpConnectionError("[WorkerMailer] Send failed: mailer is closed")
		}
		let emailOptions = options
		if (this.hooks?.beforeSend) {
			const hookResult = await this.hooks.beforeSend(options)
			if (hookResult === false) throw new SendCancelledError()
			if (hookResult && typeof hookResult === "object") emailOptions = hookResult
		}
		const email = new Email(emailOptions)
		this.emailToBeSent.enqueue(email)
		return email.sentResult
	}
	private async initializeSmtpSession(): Promise<void> {
		this.capabilities = await initializeSession(this.transport, {
			socketTimeoutMs: this.socketTimeoutMs,
			ehloHostname: this.ehloHostname,
			startTlsEnabled: this.startTlsEnabled,
			secure: this.secure,
			credentials: this.credentials,
			authType: this.authType,
			logger: this.logger,
		})
		this.active = true
	}
	private async start(): Promise<void> {
		while (this.active) {
			try {
				this.emailSending = await this.emailToBeSent.dequeue()
			} catch {
				break
			}
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
			const error = new SmtpConnectionError(
				`[WorkerMailer] Send failed: max retries (${this.maxRetries}) exceeded`,
			)
			this.emailSending.setSentError(error)
			try {
				await this.hooks?.onSendError?.(this.emailSending.options, error)
			} catch (hookErr) {
				this.logger.error("[WorkerMailer] onSendError hook error", hookErr)
			}
		}
	}
	private get dsnCtx() {
		return { transport: this.transport, capabilities: this.capabilities, dsnGlobal: this.dsn }
	}
	private async executeSend(): Promise<void> {
		if (!this.emailSending) return
		const startTime = Date.now()
		const email = this.emailSending
		const allRecipients = [...(email.to ?? []), ...(email.cc ?? []), ...(email.bcc ?? [])]
		const needsUtf8 = hasNonAscii(email.from.email) ||
			allRecipients.some((r) => hasNonAscii(r.email))
		await mailFrom({
			...this.dsnCtx,
			fromEmail: email.from.email,
			dsnOverride: email.dsnOverride,
			smtpUtf8: needsUtf8,
		})
		await rcptTo({ ...this.dsnCtx, recipients: allRecipients, dsnOverride: email.dsnOverride })
		await dataCommand(this.transport)
		let rawMessage = email.getRawMessage()
		if (this.dkimOptions) {
			if (!this.dkimKey) this.dkimKey = await resolveDkimKey(this.dkimOptions)
			rawMessage = await signDkim(rawMessage, { ...this.dkimOptions, privateKey: this.dkimKey })
		}
		const smtpData = `${applyDotStuffing(rawMessage)}\r\n.\r\n`
		const bodyResponse = await sendBody(this.transport, smtpData)
		const result: SendResult = {
			messageId: email.headers["Message-ID"] ?? "",
			accepted: allRecipients.map((u) => u.email),
			rejected: [],
			responseTime: Date.now() - startTime,
			response: bodyResponse.trim(),
		}
		email.setSentResult(result)
		try {
			await this.hooks?.afterSend?.(email.options, result)
		} catch (hookErr) {
			this.logger.error("[WorkerMailer] afterSend hook error", hookErr)
		}
	}
	private async handleSendFailure(e: unknown, attempt: number): Promise<boolean> {
		if (!this.emailSending) return true
		const message = e instanceof Error ? e.message : String(e)
		this.logger.error(
			`[WorkerMailer] Send failed: ${message} (attempt ${attempt + 1}/${this.maxRetries + 1})`,
		)
		if (!this.active || e instanceof CrlfInjectionError || e instanceof ConfigurationError) {
			this.emailSending.setSentError(e)
			try {
				const error = e instanceof Error ? e : new Error(String(e))
				await this.hooks?.onSendError?.(this.emailSending.options, error)
			} catch (hookErr) {
				this.logger.error("[WorkerMailer] onSendError hook error", hookErr)
			}
			return true
		}
		try {
			await rset(this.transport)
		} catch (rsetError: unknown) {
			if (this.autoReconnect && attempt < this.maxRetries && (await this.tryReconnect())) {
				await backoff(attempt)
				return false
			}
			this.emailSending.setSentError(e)
			const fatal = rsetError instanceof Error ? rsetError : new Error(String(rsetError))
			await this.close(fatal)
			this.reportFatalError(fatal)
			return true
		}
		if (attempt < this.maxRetries) await backoff(attempt)
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
		for (let i = 0; i < 3; i++) {
			try {
				this.logger.info(`[WorkerMailer] Reconnecting (attempt ${i + 1}/3)`)
				this.hooks?.onReconnecting?.({ attempt: i + 1 })
				this.transport.safeClose()
				this.transport = this.createTransport()
				this.capabilities = emptyCapabilities
				await this.initializeSmtpSession()
				this.logger.info("[WorkerMailer] Reconnection successful")
				return true
			} catch (err: unknown) {
				this.logger.error(
					`[WorkerMailer] Reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
				)
				if (i < 2) await backoff(i)
			}
		}
		return false
	}
	public async close(error?: Error): Promise<void> {
		this.active = false
		this.logger.info("[WorkerMailer] Closing connection", error?.message || "")
		const err = error || new SmtpConnectionError("[WorkerMailer] Mailer is shutting down")
		this.emailSending?.setSentError?.(err)
		while (this.emailToBeSent.length > 0) (await this.emailToBeSent.dequeue()).setSentError(err)
		this.emailToBeSent.close()
		await this.transport.quit().catch(() => this.logger.debug("[WorkerMailer] QUIT failed"))
		this.hooks?.onDisconnected?.({ reason: error?.message })
	}
	async [Symbol.asyncDispose](): Promise<void> {
		await this.close()
	}
	async ping(): Promise<boolean> {
		return this.active && this.transport ? noop(this.transport) : false
	}
	private reportFatalError(error: Error): void {
		this.hooks?.onFatalError ? this.hooks.onFatalError(error) : console.error(error)
	}
}

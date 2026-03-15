import type { DsnOptions, EmailOptions } from "../email/types"
import type { LogLevel } from "../logger"
import type { SendResult } from "../result"

export type AuthType = "plain" | "login" | "cram-md5"

export type Credentials = {
	username: string
	password: string
}

export interface Mailer {
	send(options: EmailOptions): Promise<SendResult>
	close(): Promise<void>
	ping(): Promise<boolean>
	[Symbol.asyncDispose](): Promise<void>
}

export type SendHooks = {
	beforeSend?: (
		email: EmailOptions,
	) => Promise<EmailOptions | false | undefined> | EmailOptions | false | undefined
	afterSend?: (email: EmailOptions, result: SendResult) => Promise<void> | void
	onSendError?: (email: EmailOptions, error: Error) => Promise<void> | void
	onConnected?: (info: { host: string; port: number }) => void
	onDisconnected?: (info: { reason?: string }) => void
	onReconnecting?: (info: { attempt: number }) => void
	onFatalError?: (error: Error) => void
}

export class SendCancelledError extends Error {
	readonly name = "SendCancelledError" as const
	constructor() {
		super("Send cancelled by beforeSend hook")
	}
}

export type WorkerMailerOptions = {
	host: string
	port: number
	secure?: boolean
	startTls?: boolean
	username?: string
	password?: string
	authType?: AuthType[]
	logLevel?: LogLevel
	dsn?: Omit<DsnOptions, "envelopeId">
	socketTimeoutMs?: number
	responseTimeoutMs?: number
	ehloHostname?: string
	maxRetries?: number
	autoReconnect?: boolean
	hooks?: SendHooks
}

export type SmtpCapabilities = {
	supportsDSN: boolean
	allowAuth: boolean
	authTypeSupported: AuthType[]
	supportsStartTls: boolean
}

export const emptyCapabilities: SmtpCapabilities = {
	supportsDSN: false,
	allowAuth: false,
	authTypeSupported: [],
	supportsStartTls: false,
}

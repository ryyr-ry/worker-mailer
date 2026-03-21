import type { DkimOptions } from "../dkim"
import type { DsnOptions, EmailOptions } from "../email/types"
import { WorkerMailerError } from "../errors"
import type { LogLevel } from "../logger"
import type { SendResult } from "../result"
import type { MailPlugin } from "./plugin"

export type AuthType = "plain" | "login" | "cram-md5"

export type Credentials = {
	username: string
	password: string
}

export interface Mailer {
	send(options: EmailOptions, sendOptions?: SendOptions): Promise<SendResult>
	close(): Promise<void>
	ping(): Promise<boolean>
	[Symbol.asyncDispose](): Promise<void>
}

export type SendOptions = {
	dryRun?: boolean
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

export class SendCancelledError extends WorkerMailerError {
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
	dkim?: DkimOptions
	plugins?: MailPlugin[]
}

export type SmtpCapabilities = {
	supportsDSN: boolean
	allowAuth: boolean
	authTypeSupported: AuthType[]
	supportsStartTls: boolean
	supportsSmtpUtf8: boolean
}

export const emptyCapabilities: Readonly<SmtpCapabilities> = Object.freeze({
	supportsDSN: false,
	allowAuth: false,
	authTypeSupported: Object.freeze([]) as unknown as AuthType[],
	supportsStartTls: false,
	supportsSmtpUtf8: false,
})

import type { LogLevel } from "../logger"

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
	username?: string
	password?: string
	authType?: AuthType[]
	logLevel?: LogLevel
	dsn?: Omit<import("../email/types").DsnOptions, "envelopeId">
	socketTimeoutMs?: number
	responseTimeoutMs?: number
	ehloHostname?: string
	maxRetries?: number
	autoReconnect?: boolean
	onError?: (error: Error) => void
}

export type SmtpCapabilities = {
	supportsDSN: boolean
	allowAuth: boolean
	authTypeSupported: AuthType[]
	supportsStartTls: boolean
}

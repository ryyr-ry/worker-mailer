import type { LogLevel } from "../logger"

export type AuthType = "plain" | "login" | "cram-md5"

export type Credentials = {
	username: string
	password: string
}

export type DsnOptions = {
	envelopeId?: string
	RET?: { HEADERS?: boolean; FULL?: boolean }
	NOTIFY?: { DELAY?: boolean; FAILURE?: boolean; SUCCESS?: boolean }
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
	autoReconnect?: boolean
	onError?: (error: Error) => void
}

export type SmtpCapabilities = {
	supportsDSN: boolean
	allowAuth: boolean
	authTypeSupported: AuthType[]
	supportsStartTls: boolean
}

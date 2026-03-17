import { ConfigurationError } from "../errors"
import { LogLevel } from "../logger"
import type { AuthType, WorkerMailerOptions } from "../mailer"
import { WorkerMailer } from "../mailer"

export function getString(env: Record<string, unknown>, key: string): string | undefined {
	const value = env[key]
	if (value === undefined || value === null) return undefined
	return String(value)
}

function requireString(env: Record<string, unknown>, key: string): string {
	const value = getString(env, key)
	if (value === undefined || value === "") {
		throw new ConfigurationError(
			`Environment variable ${key} is not set. Please check the required SMTP environment variables.`,
		)
	}
	return value
}

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined
	const lower = value.toLowerCase()
	if (lower === "true" || lower === "1" || lower === "yes") return true
	if (lower === "false" || lower === "0" || lower === "no") return false
	return undefined
}

function parseAuthType(value: string | undefined): AuthType[] | undefined {
	if (value === undefined) return undefined
	return value
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter((s): s is AuthType => s === "plain" || s === "login" || s === "cram-md5")
}

function parseLogLevel(value: string | undefined): LogLevel | undefined {
	if (value === undefined) return undefined
	const upper = value.toUpperCase()
	const levels: Record<string, LogLevel> = {
		NONE: LogLevel.NONE,
		ERROR: LogLevel.ERROR,
		WARN: LogLevel.WARN,
		INFO: LogLevel.INFO,
		DEBUG: LogLevel.DEBUG,
	}
	return levels[upper]
}

export function fromEnv(env: Record<string, unknown>, prefix = "SMTP_"): WorkerMailerOptions {
	const host = requireString(env, `${prefix}HOST`)
	const portStr = requireString(env, `${prefix}PORT`)
	const port = Number.parseInt(portStr, 10)
	if (Number.isNaN(port)) {
		throw new ConfigurationError(
			`Environment variable ${prefix}PORT value "${portStr}" is not a valid port number.`,
		)
	}

	const user = getString(env, `${prefix}USER`)
	const pass = getString(env, `${prefix}PASS`)
	const secure = parseBoolean(getString(env, `${prefix}SECURE`))
	const startTls = parseBoolean(getString(env, `${prefix}START_TLS`))
	const authType = parseAuthType(getString(env, `${prefix}AUTH_TYPE`))
	const ehloHostname = getString(env, `${prefix}EHLO_HOSTNAME`)
	const logLevel = parseLogLevel(getString(env, `${prefix}LOG_LEVEL`))
	const maxRetriesStr = getString(env, `${prefix}MAX_RETRIES`)
	const maxRetries = maxRetriesStr !== undefined ? Number.parseInt(maxRetriesStr, 10) : undefined

	const options: WorkerMailerOptions = { host, port }

	if (secure !== undefined) options.secure = secure
	if (startTls !== undefined) options.startTls = startTls
	if (user !== undefined && pass !== undefined) {
		options.username = user
		options.password = pass
	}
	if (authType !== undefined && authType.length > 0) options.authType = authType
	if (ehloHostname !== undefined) options.ehloHostname = ehloHostname
	if (logLevel !== undefined) options.logLevel = logLevel
	if (maxRetries !== undefined && !Number.isNaN(maxRetries)) {
		options.maxRetries = maxRetries
	}

	const dkimDomain = getString(env, `${prefix}DKIM_DOMAIN`)
	const dkimSelector = getString(env, `${prefix}DKIM_SELECTOR`)
	const dkimPrivateKey = getString(env, `${prefix}DKIM_PRIVATE_KEY`)

	if (dkimDomain && dkimSelector && dkimPrivateKey) {
		options.dkim = {
			domainName: dkimDomain,
			keySelector: dkimSelector,
			privateKey: dkimPrivateKey.replace(/\\n/g, "\n"),
		}
	}

	return options
}

export async function createFromEnv(
	env: Record<string, unknown>,
	prefix = "SMTP_",
): Promise<WorkerMailer> {
	const options = fromEnv(env, prefix)
	return WorkerMailer.connect(options)
}

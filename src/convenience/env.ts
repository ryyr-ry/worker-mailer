import type { DkimOptions } from "../dkim"
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
	throw new ConfigurationError(
		`Invalid boolean value "${value}". Expected: true/false, yes/no, 1/0`,
	)
}

function parseAuthType(value: string | undefined): AuthType[] | undefined {
	if (value === undefined) return undefined
	const authTypes = value
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s.length > 0)
	const invalid = authTypes.find((s) => s !== "plain" && s !== "login" && s !== "cram-md5")
	if (invalid) {
		throw new ConfigurationError(`Invalid auth type "${invalid}". Expected: plain, login, cram-md5`)
	}
	return authTypes as AuthType[]
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
	const level = levels[upper]
	if (level === undefined) {
		throw new ConfigurationError(
			`Invalid log level "${value}". Expected: DEBUG, INFO, WARN, ERROR, NONE`,
		)
	}
	return level
}

function parsePort(env: Record<string, unknown>, prefix: string): number {
	const portStr = requireString(env, `${prefix}PORT`)
	const port = Number.parseInt(portStr, 10)
	if (Number.isNaN(port)) {
		throw new ConfigurationError(
			`Environment variable ${prefix}PORT value "${portStr}" is not a valid port number.`,
		)
	}
	if (port < 1 || port > 65535) {
		throw new ConfigurationError(
			`Environment variable ${prefix}PORT value "${portStr}" is out of range (must be 1-65535).`,
		)
	}
	return port
}

function parseMaxRetries(env: Record<string, unknown>, prefix: string): number | undefined {
	const str = getString(env, `${prefix}MAX_RETRIES`)
	if (str === undefined) return undefined
	const value = Number(str)
	if (Number.isNaN(value) || value < 0 || !Number.isInteger(value)) {
		throw new ConfigurationError(
			`Environment variable ${prefix}MAX_RETRIES value "${str}" is not a valid non-negative integer.`,
		)
	}
	return value
}

function parseDkimConfig(env: Record<string, unknown>, prefix: string): DkimOptions | undefined {
	const domain = getString(env, `${prefix}DKIM_DOMAIN`)
	const selector = getString(env, `${prefix}DKIM_SELECTOR`)
	const key = getString(env, `${prefix}DKIM_PRIVATE_KEY`)
	const count = [domain, selector, key].filter((v) => v !== undefined).length
	if (count > 0 && count < 3) {
		throw new ConfigurationError(
			`All three DKIM variables (${prefix}DKIM_DOMAIN, ${prefix}DKIM_SELECTOR, ${prefix}DKIM_PRIVATE_KEY) must be set together`,
		)
	}
	if (!domain || !selector || !key) return undefined
	return {
		domainName: domain,
		keySelector: selector,
		privateKey: key.replace(/\\n/g, "\n"),
	}
}

export function fromEnv(env: Record<string, unknown>, prefix = "SMTP_"): WorkerMailerOptions {
	const host = requireString(env, `${prefix}HOST`)
	const port = parsePort(env, prefix)
	const user = getString(env, `${prefix}USER`)
	const pass = getString(env, `${prefix}PASS`)
	const options: WorkerMailerOptions = { host, port }

	const secure = parseBoolean(getString(env, `${prefix}SECURE`))
	const startTls = parseBoolean(getString(env, `${prefix}START_TLS`))
	if (secure !== undefined) options.secure = secure
	if (startTls !== undefined) options.startTls = startTls
	if (user !== undefined && pass !== undefined) {
		options.username = user
		options.password = pass
	}
	const authType = parseAuthType(getString(env, `${prefix}AUTH_TYPE`))
	if (authType !== undefined && authType.length > 0) options.authType = authType
	const ehloHostname = getString(env, `${prefix}EHLO_HOSTNAME`)
	if (ehloHostname !== undefined) options.ehloHostname = ehloHostname
	const logLevel = parseLogLevel(getString(env, `${prefix}LOG_LEVEL`))
	if (logLevel !== undefined) options.logLevel = logLevel
	const maxRetries = parseMaxRetries(env, prefix)
	if (maxRetries !== undefined) options.maxRetries = maxRetries
	const dkim = parseDkimConfig(env, prefix)
	if (dkim) options.dkim = dkim

	return options
}

export async function createFromEnv(
	env: Record<string, unknown>,
	prefix = "SMTP_",
): Promise<WorkerMailer> {
	const options = fromEnv(env, prefix)
	return WorkerMailer.connect(options)
}

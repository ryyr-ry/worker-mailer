import type { EmailOptions } from "./email"
import { LogLevel } from "./logger"
import type { AuthType, WorkerMailerOptions } from "./mailer"
import { WorkerMailer } from "./mailer"

function getString(env: Record<string, unknown>, key: string): string | undefined {
	const value = env[key]
	if (value === undefined || value === null) return undefined
	return String(value)
}

function requireString(env: Record<string, unknown>, key: string): string {
	const value = getString(env, key)
	if (value === undefined || value === "") {
		throw new Error(
			`環境変数 ${key} が設定されていません。SMTP接続に必要な環境変数を確認してください。`,
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

export function fromEnv(env: Record<string, unknown>): WorkerMailerOptions {
	const host = requireString(env, "SMTP_HOST")
	const portStr = requireString(env, "SMTP_PORT")
	const port = Number.parseInt(portStr, 10)
	if (Number.isNaN(port)) {
		throw new Error(`環境変数 SMTP_PORT の値 "${portStr}" は有効なポート番号ではありません。`)
	}

	const user = getString(env, "SMTP_USER")
	const pass = getString(env, "SMTP_PASS")
	const secure = parseBoolean(getString(env, "SMTP_SECURE"))
	const startTls = parseBoolean(getString(env, "SMTP_START_TLS"))
	const authType = parseAuthType(getString(env, "SMTP_AUTH_TYPE"))
	const ehloHostname = getString(env, "SMTP_EHLO_HOSTNAME")
	const logLevel = parseLogLevel(getString(env, "SMTP_LOG_LEVEL"))
	const maxRetriesStr = getString(env, "SMTP_MAX_RETRIES")
	const maxRetries = maxRetriesStr !== undefined ? Number.parseInt(maxRetriesStr, 10) : undefined

	const options: WorkerMailerOptions = { host, port }

	if (secure !== undefined) options.secure = secure
	if (startTls !== undefined) options.startTls = startTls
	if (user !== undefined && pass !== undefined) {
		options.credentials = { username: user, password: pass }
	}
	if (authType !== undefined && authType.length > 0) options.authType = authType
	if (ehloHostname !== undefined) options.ehloHostname = ehloHostname
	if (logLevel !== undefined) options.logLevel = logLevel
	if (maxRetries !== undefined && !Number.isNaN(maxRetries)) {
		options.maxRetries = maxRetries
	}

	return options
}

export async function createFromEnv(env: Record<string, unknown>): Promise<WorkerMailer> {
	const options = fromEnv(env)
	return WorkerMailer.connect(options)
}

export async function sendOnce(
	env: Record<string, unknown>,
	emailOptions: EmailOptions,
): Promise<void> {
	const mailer = await createFromEnv(env)
	try {
		await mailer.send(emailOptions)
	} finally {
		await mailer.close()
	}
}

function credentialsFromEnv(env: Record<string, unknown>): {
	username: string
	password: string
} {
	const user = getString(env, "SMTP_USER")
	const pass = getString(env, "SMTP_PASS")
	return {
		username: user ?? "",
		password: pass ?? "",
	}
}

export function gmailPreset(env: Record<string, unknown>): WorkerMailerOptions {
	return {
		host: "smtp.gmail.com",
		port: 587,
		secure: false,
		startTls: true,
		authType: ["plain"],
		credentials: credentialsFromEnv(env),
	}
}

export function outlookPreset(env: Record<string, unknown>): WorkerMailerOptions {
	return {
		host: "smtp.office365.com",
		port: 587,
		secure: false,
		startTls: true,
		authType: ["plain"],
		credentials: credentialsFromEnv(env),
	}
}

export function sendgridPreset(env: Record<string, unknown>): WorkerMailerOptions {
	return {
		host: "smtp.sendgrid.net",
		port: 587,
		secure: false,
		startTls: true,
		authType: ["plain"],
		credentials: credentialsFromEnv(env),
	}
}

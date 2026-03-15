export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	NONE = 4,
}

const AUTH_CREDENTIAL_PATTERN = /AUTH (PLAIN|LOGIN)\s+\S+/gi
const BASE64_LONG_PATTERN = /[A-Za-z0-9+/=]{64,}/g

export default class Logger {
	private readonly prefix: string

	constructor(
		private readonly level: LogLevel = LogLevel.INFO,
		prefix: string,
	) {
		this.prefix = prefix
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.DEBUG) {
			console.debug(this.formatMessage(this.sanitize(message)), ...args)
		}
	}

	info(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.INFO) {
			console.info(this.formatMessage(message), ...args)
		}
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.WARN) {
			console.warn(this.formatMessage(message), ...args)
		}
	}

	error(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.ERROR) {
			console.error(this.formatMessage(message), ...args)
		}
	}

	private formatMessage(message: string): string {
		return `[${new Date().toISOString()}] ${this.prefix} ${message}`
	}

	private sanitize(message: string): string {
		return message
			.replace(AUTH_CREDENTIAL_PATTERN, "AUTH $1 [REDACTED]")
			.replace(BASE64_LONG_PATTERN, "[REDACTED]")
	}
}

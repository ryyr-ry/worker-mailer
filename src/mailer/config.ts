import type { WorkerMailerOptions } from "./types"

export function inferSecurity(options: Pick<WorkerMailerOptions, "port" | "secure" | "startTls">): {
	secure: boolean
	startTls: boolean
} {
	if (options.secure !== undefined || options.startTls !== undefined) {
		return {
			secure: options.secure ?? false,
			startTls: options.startTls ?? !options.secure,
		}
	}
	if (options.port === 465) {
		return { secure: true, startTls: false }
	}
	return { secure: false, startTls: true }
}

export function validatePortSecurity(
	port: number,
	secure: boolean,
	startTlsEnabled: boolean,
): void {
	if (port === 587 && secure) {
		throw new Error(
			"[WorkerMailer] Invalid configuration: port 587 requires STARTTLS, not implicit TLS (secure: true)",
		)
	}
	if (port === 465 && !secure && startTlsEnabled) {
		throw new Error(
			"[WorkerMailer] Invalid configuration: port 465 requires implicit TLS (secure: true), not STARTTLS",
		)
	}
}

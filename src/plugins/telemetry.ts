import type { EmailOptions } from "../email/types"
import type { MailPlugin } from "../mailer/plugin"
import type { SendResult } from "../result"

export type TelemetrySendEvent = {
	type: "send"
	durationMs: number
	email: EmailOptions
	recipientCount: number
	result: SendResult
}

export type TelemetryErrorEvent = {
	type: "error"
	email: EmailOptions
	error: Error
}

export type TelemetryConnectEvent = {
	type: "connect"
	host: string
	port: number
}

export type TelemetryDisconnectEvent = {
	type: "disconnect"
	reason?: string
}

export type TelemetryEvent =
	| TelemetrySendEvent
	| TelemetryErrorEvent
	| TelemetryConnectEvent
	| TelemetryDisconnectEvent

export type TelemetryOptions = {
	onEvent: (event: TelemetryEvent) => void | Promise<void>
}

export function telemetryPlugin(options: TelemetryOptions): MailPlugin {
	return {
		name: "telemetry",
		afterSend: (email, result) =>
			options.onEvent({
				type: "send",
				durationMs: result.responseTime,
				email,
				recipientCount: result.accepted.length + result.rejected.length,
				result,
			}),
		onSendError: (email, error) => options.onEvent({ type: "error", email, error }),
		onConnected: (info) => options.onEvent({ type: "connect", ...info }),
		onDisconnected: (info) => options.onEvent({ type: "disconnect", reason: info.reason }),
	}
}

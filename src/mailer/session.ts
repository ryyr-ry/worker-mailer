import { ConfigurationError, SmtpConnectionError } from "../errors"
import type Logger from "../logger"
import { authenticate } from "./auth"
import { ehlo, greet, startTls } from "./handshake"
import type { SmtpTransport } from "./transport"
import type { AuthType, Credentials, SmtpCapabilities } from "./types"

export interface SessionConfig {
	socketTimeoutMs: number
	ehloHostname: string
	startTlsEnabled: boolean
	secure: boolean
	credentials?: Credentials
	authType: AuthType[]
	logger: Logger
}

export async function initializeSession(
	transport: SmtpTransport,
	config: SessionConfig,
): Promise<SmtpCapabilities> {
	config.logger.info("[WorkerMailer] Connecting to SMTP server")
	await transport.waitForOpen(config.socketTimeoutMs)
	config.logger.info("[WorkerMailer] SMTP server connected")
	await greet(transport)
	let capabilities = await ehlo(transport, config.ehloHostname)
	const tlsEstablished = config.secure
	if (config.startTlsEnabled && !config.secure) {
		if (!capabilities.supportsStartTls) {
			throw new SmtpConnectionError(
				"[WorkerMailer] STARTTLS required but server does not advertise STARTTLS support",
			)
		}
		await startTls(transport)
		capabilities = await ehlo(transport, config.ehloHostname)
	}
	const encrypted = tlsEstablished || config.startTlsEnabled
	if (config.credentials) {
		if (!encrypted) {
			throw new ConfigurationError(
				"[WorkerMailer] Cannot send credentials over plaintext connection. " +
					"Enable secure (port 465) or startTls (port 587) to encrypt the connection",
			)
		}
		if (!capabilities.allowAuth) {
			throw new ConfigurationError(
				"[WorkerMailer] Credentials provided but server does not advertise AUTH support. " +
					"Verify the server configuration or remove credentials.",
			)
		}
		await authenticate({
			transport,
			credentials: config.credentials,
			capabilities,
			preferredTypes: config.authType,
			logger: config.logger,
		})
	}
	return capabilities
}

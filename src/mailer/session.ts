import { ConfigurationError } from "../errors"
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
	if (config.startTlsEnabled && !config.secure && capabilities.supportsStartTls) {
		await startTls(transport)
		capabilities = await ehlo(transport, config.ehloHostname)
	}
	if (config.credentials) {
		await authenticate({
			transport,
			credentials: config.credentials,
			capabilities,
			preferredTypes: config.authType,
			logger: config.logger,
		})
	} else if (capabilities.allowAuth) {
		throw new ConfigurationError(
			"[WorkerMailer] Authentication required but no credentials provided",
		)
	}
	return capabilities
}

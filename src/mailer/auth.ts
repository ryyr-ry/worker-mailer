import { SmtpAuthError } from "../errors"
import type Logger from "../logger"
import { encode, fromBase64, toBase64 } from "../utils"
import type { SmtpTransport } from "./transport"
import type { AuthType, Credentials, SmtpCapabilities } from "./types"

interface AuthenticateParams {
	transport: SmtpTransport
	credentials: Credentials
	capabilities: SmtpCapabilities
	preferredTypes: AuthType[]
	logger: Logger
}

export async function authenticate({
	transport,
	credentials,
	capabilities,
	preferredTypes,
	logger,
}: AuthenticateParams): Promise<void> {
	if (!capabilities.allowAuth) {
		return
	}
	const selected = selectAuthType(capabilities.authTypeSupported, preferredTypes)
	if (!selected) {
		throw new SmtpAuthError("[WorkerMailer] No supported authentication method found")
	}
	switch (selected) {
		case "plain":
			return authPlain(transport, credentials)
		case "login":
			return authLogin(transport, credentials)
		case "cram-md5":
			return authCramMd5(transport, credentials, logger)
	}
}

function selectAuthType(
	supported: readonly string[],
	preferred: readonly AuthType[],
): AuthType | undefined {
	return preferred.find((type) => supported.includes(type))
}

async function authPlain(transport: SmtpTransport, credentials: Credentials): Promise<void> {
	const userPassBase64 = toBase64(`\u0000${credentials.username}\u0000${credentials.password}`)
	await transport.writeLine(`AUTH PLAIN ${userPassBase64}`)
	const authResult = await transport.readTimeout()
	if (!authResult.startsWith("2")) {
		throw new SmtpAuthError(`[WorkerMailer] PLAIN authentication failed: ${authResult}`)
	}
}

async function authLogin(transport: SmtpTransport, credentials: Credentials): Promise<void> {
	await transport.writeLine("AUTH LOGIN")
	const startLoginResponse = await transport.readTimeout()
	if (!startLoginResponse.startsWith("3")) {
		throw new SmtpAuthError(`[WorkerMailer] LOGIN authentication failed: ${startLoginResponse}`)
	}

	const usernameBase64 = toBase64(credentials.username)
	await transport.writeLine(usernameBase64)
	const userResponse = await transport.readTimeout()
	if (!userResponse.startsWith("3")) {
		throw new SmtpAuthError(`[WorkerMailer] LOGIN authentication failed: ${userResponse}`)
	}

	const passwordBase64 = toBase64(credentials.password)
	await transport.writeLine(passwordBase64)
	const authResult = await transport.readTimeout()
	if (!authResult.startsWith("2")) {
		throw new SmtpAuthError(`[WorkerMailer] LOGIN authentication failed: ${authResult}`)
	}
}

async function authCramMd5(
	transport: SmtpTransport,
	credentials: Credentials,
	logger: Logger,
): Promise<void> {
	logger.warn(
		"CRAM-MD5 uses HMAC-MD5 which is cryptographically deprecated. Consider using PLAIN or LOGIN over TLS instead.",
	)
	await transport.writeLine("AUTH CRAM-MD5")
	const challengeResponse = await transport.readTimeout()
	const challengeWithBase64Encoded = challengeResponse
		.trim()
		.match(/^334\s+(.+)$/)
		?.pop()
	if (!challengeWithBase64Encoded) {
		throw new SmtpAuthError(
			`[WorkerMailer] CRAM-MD5 authentication failed: invalid challenge: ${challengeResponse}`,
		)
	}

	const challenge = fromBase64(challengeWithBase64Encoded)

	const keyData = encode(credentials.password)
	const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "MD5" }, false, [
		"sign",
	])

	const challengeData = encode(challenge)
	const signature = await crypto.subtle.sign("HMAC", key, challengeData)

	const challengeSolved = Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")

	await transport.writeLine(toBase64(`${credentials.username} ${challengeSolved}`))
	const authResult = await transport.readTimeout()
	if (!authResult.startsWith("2")) {
		throw new SmtpAuthError(`[WorkerMailer] CRAM-MD5 authentication failed: ${authResult}`)
	}
}

import { SmtpCommandError, SmtpConnectionError } from "../errors"
import type { SmtpTransport } from "./transport"
import type { SmtpCapabilities } from "./types"

export async function greet(transport: SmtpTransport): Promise<void> {
	const response = await transport.readTimeout()
	if (!response.startsWith("220")) {
		throw new SmtpConnectionError(
			`[WorkerMailer] Connection failed: unexpected greeting from SMTP server: ${response}`,
		)
	}
}

export function parseCapabilities(response: string): SmtpCapabilities {
	const capabilities: SmtpCapabilities = {
		supportsDSN: false,
		allowAuth: false,
		authTypeSupported: [],
		supportsStartTls: false,
	}

	if (/[ -]AUTH\b/i.test(response)) {
		capabilities.allowAuth = true
	}
	if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)PLAIN/i.test(response)) {
		capabilities.authTypeSupported.push("plain")
	}
	if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)LOGIN/i.test(response)) {
		capabilities.authTypeSupported.push("login")
	}
	if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)CRAM-MD5/i.test(response)) {
		capabilities.authTypeSupported.push("cram-md5")
	}
	if (/[ -]STARTTLS\b/i.test(response)) {
		capabilities.supportsStartTls = true
	}
	if (/[ -]DSN\b/i.test(response)) {
		capabilities.supportsDSN = true
	}

	return capabilities
}

export async function ehlo(transport: SmtpTransport, hostname: string): Promise<SmtpCapabilities> {
	await transport.writeLine(`EHLO ${hostname}`)
	const response = await transport.readTimeout()
	if (response.startsWith("421")) {
		throw new SmtpCommandError("EHLO", response)
	}
	if (!response.startsWith("2")) {
		await helo(transport, hostname)
		return {
			supportsDSN: false,
			allowAuth: false,
			authTypeSupported: [],
			supportsStartTls: false,
		}
	}
	return parseCapabilities(response)
}

export async function helo(transport: SmtpTransport, hostname: string): Promise<void> {
	await transport.writeLine(`HELO ${hostname}`)
	const response = await transport.readTimeout()
	if (response.startsWith("2")) {
		return
	}
	throw new SmtpCommandError("HELO", response)
}

export async function startTls(transport: SmtpTransport): Promise<void> {
	await transport.writeLine("STARTTLS")
	const response = await transport.readTimeout()
	if (!response.startsWith("220")) {
		throw new SmtpCommandError("STARTTLS", response)
	}
	transport.upgradeTls()
}

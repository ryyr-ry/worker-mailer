import type { DsnOptions } from "../email/types"
import { ConfigurationError, CrlfInjectionError, SmtpCommandError } from "../errors"
import type { SmtpTransport } from "./transport"
import type { SmtpCapabilities } from "./types"

type DsnParam = Omit<DsnOptions, "envelopeId"> | DsnOptions

interface MailFromParams {
	transport: SmtpTransport
	fromEmail: string
	capabilities: SmtpCapabilities
	dsnGlobal?: DsnParam
	dsnOverride?: DsnOptions
	smtpUtf8?: boolean
}

export async function mailFrom({
	transport,
	fromEmail,
	capabilities,
	dsnGlobal,
	dsnOverride,
	smtpUtf8,
}: MailFromParams): Promise<void> {
	let message = `MAIL FROM: <${fromEmail}>`
	if (smtpUtf8 && capabilities.supportsSmtpUtf8) {
		message += " SMTPUTF8"
	}
	if (capabilities.supportsDSN) {
		message += ` ${buildRet(dsnGlobal, dsnOverride)}`
		if (dsnOverride?.envelopeId) {
			if (/[\r\n]/.test(dsnOverride.envelopeId)) {
				throw new CrlfInjectionError("DSN envelope ID")
			}
			// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional xtext validation per RFC 3461
			if (/[\x00-\x20\x7f+=]/.test(dsnOverride.envelopeId)) {
				throw new ConfigurationError(
					"DSN envelope ID contains invalid characters (spaces, control chars, + or =)",
				)
			}
			message += ` ENVID=${dsnOverride.envelopeId}`
		}
	}
	await transport.writeLine(message)
	const response = await transport.readTimeout()
	if (!response.startsWith("2")) {
		throw new SmtpCommandError("MAIL FROM", `${message} ${response}`)
	}
}

interface RcptToParams {
	transport: SmtpTransport
	recipients: ReadonlyArray<{ email: string }>
	capabilities: SmtpCapabilities
	dsnGlobal?: DsnParam
	dsnOverride?: DsnOptions
}

export async function rcptTo({
	transport,
	recipients,
	capabilities,
	dsnGlobal,
	dsnOverride,
}: RcptToParams): Promise<void> {
	for (const user of recipients) {
		let message = `RCPT TO: <${user.email}>`
		if (capabilities.supportsDSN) {
			message += buildNotify(dsnGlobal, dsnOverride)
		}
		await transport.writeLine(message)
		const rcptResponse = await transport.readTimeout()
		if (!rcptResponse.startsWith("2")) {
			throw new SmtpCommandError("RCPT TO", `${message} ${rcptResponse}`)
		}
	}
}

export async function dataCommand(transport: SmtpTransport): Promise<void> {
	await transport.writeLine("DATA")
	const response = await transport.readTimeout()
	if (!response.startsWith("3")) {
		throw new SmtpCommandError("DATA", response)
	}
}

export async function sendBody(transport: SmtpTransport, emailData: string): Promise<string> {
	await transport.write(emailData)
	const response = await transport.readTimeout()
	if (!response.startsWith("2")) {
		throw new SmtpCommandError("Send body", response)
	}
	return response
}

export async function rset(transport: SmtpTransport): Promise<void> {
	await transport.writeLine("RSET")
	const response = await transport.readTimeout()
	if (!response.startsWith("2")) {
		throw new SmtpCommandError("RSET", response)
	}
}

export async function noop(transport: SmtpTransport): Promise<boolean> {
	try {
		await transport.writeLine("NOOP")
		const response = await transport.readTimeout()
		return response.startsWith("250")
	} catch {
		return false
	}
}

export function buildNotify(dsnGlobal?: DsnParam, dsnOverride?: DsnOptions): string {
	const notifications: string[] = []
	if (dsnOverride?.NOTIFY?.SUCCESS || (!dsnOverride?.NOTIFY && dsnGlobal?.NOTIFY?.SUCCESS)) {
		notifications.push("SUCCESS")
	}
	if (dsnOverride?.NOTIFY?.FAILURE || (!dsnOverride?.NOTIFY && dsnGlobal?.NOTIFY?.FAILURE)) {
		notifications.push("FAILURE")
	}
	if (dsnOverride?.NOTIFY?.DELAY || (!dsnOverride?.NOTIFY && dsnGlobal?.NOTIFY?.DELAY)) {
		notifications.push("DELAY")
	}
	return notifications.length > 0 ? ` NOTIFY=${notifications.join(",")}` : " NOTIFY=NEVER"
}

export function buildRet(dsnGlobal?: DsnParam, dsnOverride?: DsnOptions): string {
	const ret = dsnOverride?.RET ?? dsnGlobal?.RET
	if (!ret) return ""
	if (ret.FULL && ret.HEADERS) {
		throw new ConfigurationError("RET cannot specify both FULL and HEADERS (RFC 3461)")
	}
	if (ret.FULL) return "RET=FULL"
	if (ret.HEADERS) return "RET=HDRS"
	return ""
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ASCII range check
const NON_ASCII_PATTERN = /[^\x00-\x7F]/

/** Checks whether an email address contains non-ASCII characters */
export function hasNonAscii(value: string): boolean {
	return NON_ASCII_PATTERN.test(value)
}

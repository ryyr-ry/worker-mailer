import type { DsnOptions } from "../email/types"
import type { SmtpTransport } from "./transport"
import type { SmtpCapabilities } from "./types"

type DsnParam = Omit<DsnOptions, "envelopeId"> | DsnOptions

export async function mailFrom(
	transport: SmtpTransport,
	fromEmail: string,
	capabilities: SmtpCapabilities,
	dsnGlobal?: DsnParam,
	dsnOverride?: DsnOptions,
): Promise<void> {
	let message = `MAIL FROM: <${fromEmail}>`
	if (capabilities.supportsDSN) {
		message += ` ${buildRet(dsnGlobal, dsnOverride)}`
		if (dsnOverride?.envelopeId) {
			message += ` ENVID=${dsnOverride.envelopeId}`
		}
	}
	await transport.writeLine(message)
	const response = await transport.readTimeout()
	if (!response.startsWith("2")) {
		throw new Error(`[WorkerMailer] MAIL FROM failed: ${message} ${response}`)
	}
}

export async function rcptTo(
	transport: SmtpTransport,
	recipients: ReadonlyArray<{ email: string }>,
	capabilities: SmtpCapabilities,
	dsnGlobal?: DsnParam,
	dsnOverride?: DsnOptions,
): Promise<void> {
	for (const user of recipients) {
		let message = `RCPT TO: <${user.email}>`
		if (capabilities.supportsDSN) {
			message += buildNotify(dsnGlobal, dsnOverride)
		}
		await transport.writeLine(message)
		const rcptResponse = await transport.readTimeout()
		if (!rcptResponse.startsWith("2")) {
			throw new Error(`[WorkerMailer] RCPT TO failed: ${message} ${rcptResponse}`)
		}
	}
}

export async function dataCommand(transport: SmtpTransport): Promise<void> {
	await transport.writeLine("DATA")
	const response = await transport.readTimeout()
	if (!response.startsWith("3")) {
		throw new Error(`[WorkerMailer] DATA command failed: ${response}`)
	}
}

export async function sendBody(transport: SmtpTransport, emailData: string): Promise<string> {
	await transport.write(emailData)
	const response = await transport.readTimeout()
	if (!response.startsWith("2")) {
		throw new Error(`[WorkerMailer] Send body failed: ${response}`)
	}
	return response
}

export async function rset(transport: SmtpTransport): Promise<void> {
	await transport.writeLine("RSET")
	const response = await transport.readTimeout()
	if (!response.startsWith("2")) {
		throw new Error(`[WorkerMailer] RSET failed: ${response}`)
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
	const ret: string[] = []
	if (dsnOverride?.RET?.HEADERS || (!dsnOverride?.RET && dsnGlobal?.RET?.HEADERS)) {
		ret.push("HDRS")
	}
	if (dsnOverride?.RET?.FULL || (!dsnOverride?.RET && dsnGlobal?.RET?.FULL)) {
		ret.push("FULL")
	}
	return ret.length > 0 ? `RET=${ret.join(",")}` : ""
}

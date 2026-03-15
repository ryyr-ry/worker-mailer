import { arrayBufferToBase64, encodeQuotedPrintable } from "../utils"
import { encodeHeader, foldHeaderLine } from "./header"
import type { User } from "./types"

export function resolveHeaders(params: {
	from: User
	to: User[]
	cc?: User[]
	reply?: User
	subject: string
	headers: Record<string, string>
}): void {
	const { from, to, cc, reply, subject, headers } = params

	// resolveFrom
	if (!headers.From) {
		let fromValue = from.email
		if (from.name) {
			fromValue = `"${encodeHeader(from.name)}" <${fromValue}>`
		}
		headers.From = fromValue
	}

	// resolveTo
	if (!headers.To) {
		const toAddresses = to.map((user) => {
			if (user.name) {
				return `"${encodeHeader(user.name)}" <${user.email}>`
			}
			return user.email
		})
		headers.To = toAddresses.join(", ")
	}

	// resolveReply
	if (!headers["Reply-To"] && reply) {
		let replyAddress = reply.email
		if (reply.name) {
			replyAddress = `"${encodeHeader(reply.name)}" <${replyAddress}>`
		}
		headers["Reply-To"] = replyAddress
	}

	// resolveCC
	if (!headers.CC && cc) {
		const ccAddresses = cc.map((user) => {
			if (user.name) {
				return `"${encodeHeader(user.name)}" <${user.email}>`
			}
			return user.email
		})
		headers.CC = ccAddresses.join(", ")
	}

	// resolveSubject
	if (!headers.Subject && subject) {
		headers.Subject = encodeHeader(subject)
	}

	headers.Date = headers.Date ?? new Date().toUTCString()
	headers["Message-ID"] =
		headers["Message-ID"] ?? `<${crypto.randomUUID()}@${from.email.split("@").pop()}>`
}

export function applyDotStuffing(data: string): string {
	let result = data.replace(/\r\n\./g, "\r\n..")
	if (result.startsWith(".")) {
		result = `.${result}`
	}
	return result
}

export function generateSafeBoundary(prefix: string): string {
	const bytes = new Uint8Array(28)
	crypto.getRandomValues(bytes)
	const hex = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")

	let boundary = prefix + hex
	boundary = boundary.replace(/[<>@,;:\\/[\]?=" ]/g, "_")

	return boundary
}

export function getMimeType(filename: string): string {
	const extension = filename.split(".").pop()?.toLowerCase()

	const mimeTypes: { [key: string]: string } = {
		txt: "text/plain",
		html: "text/html",
		csv: "text/csv",
		pdf: "application/pdf",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		zip: "application/zip",
	}

	return mimeTypes[extension || "txt"] || "application/octet-stream"
}

export function buildMimeMessage(params: {
	headers: Record<string, string>
	text?: string
	html?: string
	attachments?: {
		filename: string
		content: string | Uint8Array | ArrayBuffer
		mimeType?: string
	}[]
}): string {
	const { headers, text, html, attachments } = params

	const headersArray: string[] = ["MIME-Version: 1.0"]
	for (const [key, value] of Object.entries(headers)) {
		headersArray.push(foldHeaderLine(`${key}: ${value}`))
	}
	const mixedBoundary = generateSafeBoundary("mixed_")
	const alternativeBoundary = generateSafeBoundary("alternative_")

	headersArray.push(foldHeaderLine(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`))
	const headerBlock = headersArray.join("\r\n")

	let emailData = `${headerBlock}\r\n\r\n`
	emailData += `--${mixedBoundary}\r\n`

	emailData += `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n\r\n`

	if (text) {
		emailData += `--${alternativeBoundary}\r\n`
		emailData += `Content-Type: text/plain; charset="UTF-8"\r\n`
		emailData += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`
		const encodedText = encodeQuotedPrintable(text)
		emailData += `${encodedText}\r\n\r\n`
	}

	if (html) {
		emailData += `--${alternativeBoundary}\r\n`
		emailData += `Content-Type: text/html; charset="UTF-8"\r\n`
		emailData += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`
		const encodedHtml = encodeQuotedPrintable(html)
		emailData += `${encodedHtml}\r\n\r\n`
	}

	emailData += `--${alternativeBoundary}--\r\n`

	if (attachments) {
		for (const attachment of attachments) {
			const mimeType = attachment.mimeType || getMimeType(attachment.filename)
			emailData += `--${mixedBoundary}\r\n`
			emailData += `Content-Type: ${mimeType}; name="${attachment.filename}"\r\n`
			emailData += `Content-Description: ${attachment.filename}\r\n`
			emailData += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`
			emailData += `Content-Transfer-Encoding: base64\r\n\r\n`

			const base64Content =
				typeof attachment.content === "string"
					? attachment.content
					: arrayBufferToBase64(
							attachment.content instanceof ArrayBuffer
								? attachment.content
								: (attachment.content.buffer.slice(
										attachment.content.byteOffset,
										attachment.content.byteOffset + attachment.content.byteLength,
									) as ArrayBuffer),
						)

			const lines = base64Content.match(/.{1,72}/g)
			if (lines) {
				emailData += `${lines.join("\r\n")}`
			} else {
				emailData += `${base64Content}`
			}
			emailData += "\r\n\r\n"
		}
	}
	emailData += `--${mixedBoundary}--\r\n`

	const safeEmailData = applyDotStuffing(emailData)

	return `${safeEmailData}\r\n.\r\n`
}

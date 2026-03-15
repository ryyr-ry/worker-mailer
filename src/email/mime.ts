import { arrayBufferToBase64, encodeQuotedPrintable } from "../utils"
import { foldHeaderLine } from "./header"
import type { Attachment, CalendarEventPart, InlineAttachment } from "./types"

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
	const ext = filename.split(".").pop()?.toLowerCase()
	const types: Record<string, string> = {
		txt: "text/plain",
		html: "text/html",
		csv: "text/csv",
		pdf: "application/pdf",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		webp: "image/webp",
		zip: "application/zip",
	}
	return types[ext || "txt"] || "application/octet-stream"
}

export type MimeMessageParams = {
	headers: Record<string, string>
	text?: string
	html?: string
	attachments?: Attachment[]
	inlineAttachments?: InlineAttachment[]
	calendarEvent?: CalendarEventPart
}
function buildTextPart(text: string): string {
	const encoded = encodeQuotedPrintable(text)
	return [
		'Content-Type: text/plain; charset="UTF-8"',
		"Content-Transfer-Encoding: quoted-printable",
		"",
		encoded,
	].join("\r\n")
}

function buildHtmlPart(html: string): string {
	const encoded = encodeQuotedPrintable(html)
	return [
		'Content-Type: text/html; charset="UTF-8"',
		"Content-Transfer-Encoding: quoted-printable",
		"",
		encoded,
	].join("\r\n")
}

function encodeAttachmentContent(content: string | Uint8Array | ArrayBuffer): string {
	const base64Content =
		typeof content === "string"
			? content
			: arrayBufferToBase64(
					content instanceof ArrayBuffer
						? content
						: (content.buffer.slice(
								content.byteOffset,
								content.byteOffset + content.byteLength,
							) as ArrayBuffer),
				)

	const lines = base64Content.match(/.{1,72}/g)
	return lines ? lines.join("\r\n") : base64Content
}

function buildAttachmentPart(attachment: Attachment): string {
	const mimeType = attachment.mimeType || getMimeType(attachment.filename)
	const encoded = encodeAttachmentContent(attachment.content)
	return [
		`Content-Type: ${mimeType}; name="${attachment.filename}"`,
		`Content-Description: ${attachment.filename}`,
		`Content-Disposition: attachment; filename="${attachment.filename}"`,
		"Content-Transfer-Encoding: base64",
		"",
		encoded,
	].join("\r\n")
}

function buildInlinePart(inline: InlineAttachment): string {
	const mimeType = inline.mimeType || getMimeType(inline.filename)
	const encoded = encodeAttachmentContent(inline.content)
	return [
		`Content-Type: ${mimeType}; name="${inline.filename}"`,
		`Content-Disposition: inline; filename="${inline.filename}"`,
		`Content-ID: <${inline.cid}>`,
		"Content-Transfer-Encoding: base64",
		"",
		encoded,
	].join("\r\n")
}

function buildCalendarPart(event: CalendarEventPart): string {
	const method = event.method ?? "REQUEST"
	const encoded = encodeQuotedPrintable(event.content)
	return [
		`Content-Type: text/calendar; charset="UTF-8"; method=${method}`,
		"Content-Transfer-Encoding: quoted-printable",
		"",
		encoded,
	].join("\r\n")
}

function buildMultipart(type: "mixed" | "alternative" | "related", parts: string[]): string {
	const boundary = generateSafeBoundary(`${type}_`)
	const header = `Content-Type: multipart/${type}; boundary="${boundary}"`
	const body = parts.map((p) => `--${boundary}\r\n${p}`).join("\r\n")
	return `${header}\r\n\r\n${body}\r\n--${boundary}--`
}

function buildContentBody(params: MimeMessageParams): string {
	const { text, html, attachments, inlineAttachments, calendarEvent } = params
	const hasText = text !== undefined
	const hasHtml = html !== undefined
	const hasInline = inlineAttachments !== undefined && inlineAttachments.length > 0
	const hasAttach = attachments !== undefined && attachments.length > 0
	const hasCal = calendarEvent !== undefined
	const htmlPart = hasHtml ? buildHtmlPart(html) : ""
	const textPart = hasText ? buildTextPart(text) : ""
	const inlines = hasInline && inlineAttachments ? inlineAttachments.map(buildInlinePart) : []
	const attaches = hasAttach && attachments ? attachments.map(buildAttachmentPart) : []
	const calPart = hasCal ? buildCalendarPart(calendarEvent) : ""
	const related = hasInline ? buildMultipart("related", [htmlPart, ...inlines]) : htmlPart
	const htmlOrRelated = hasInline ? related : htmlPart
	if (!hasHtml && !hasAttach && hasText) return textPart
	if (!hasText && hasHtml && !hasAttach && !hasInline) return htmlPart
	if (!hasText && hasHtml && hasInline && !hasAttach) return related
	return buildWithAttachAndCal({
		hasText,
		hasHtml,
		hasInline,
		hasAttach,
		hasCal,
		textPart,
		htmlOrRelated,
		htmlPart,
		calPart,
		attaches,
	})
}

function buildWithAttachAndCal(ctx: {
	hasText: boolean
	hasHtml: boolean
	hasInline: boolean
	hasAttach: boolean
	hasCal: boolean
	textPart: string
	htmlOrRelated: string
	htmlPart: string
	calPart: string
	attaches: string[]
}): string {
	const { hasText, hasHtml, hasInline, hasAttach, hasCal } = ctx
	const { textPart, htmlOrRelated, htmlPart, calPart, attaches } = ctx

	const altParts = buildAltParts(
		hasText,
		hasInline,
		textPart,
		htmlOrRelated,
		htmlPart,
		calPart,
		hasCal,
	)

	if (hasText && hasHtml && !hasAttach) {
		return buildMultipart("alternative", altParts)
	}

	if (hasText && !hasHtml && hasAttach) {
		return buildMultipart("mixed", [textPart, ...attaches])
	}

	if (!hasText && hasHtml && !hasInline && hasAttach) {
		return buildMultipart("mixed", [htmlPart, ...attaches])
	}

	if (!hasText && hasHtml && hasInline && hasAttach) {
		return buildMultipart("mixed", [htmlOrRelated, ...attaches])
	}

	if (hasText && hasHtml && hasAttach) {
		const alt = buildMultipart("alternative", altParts)
		return buildMultipart("mixed", [alt, ...attaches])
	}

	if (hasText) return textPart
	if (hasHtml) return htmlPart
	return ""
}

function buildAltParts(
	hasText: boolean,
	hasInline: boolean,
	textPart: string,
	htmlOrRelated: string,
	htmlPart: string,
	calPart: string,
	hasCal: boolean,
): string[] {
	const parts: string[] = []
	if (hasText) parts.push(textPart)
	parts.push(hasInline ? htmlOrRelated : htmlPart)
	if (hasCal) parts.push(calPart)
	return parts
}

export function buildMimeMessage(params: MimeMessageParams): string {
	const { headers } = params

	const headersArray: string[] = ["MIME-Version: 1.0"]
	for (const [key, value] of Object.entries(headers)) {
		headersArray.push(foldHeaderLine(`${key}: ${value}`))
	}
	const body = buildContentBody(params)
	// Extract Content-Type from body (first line) and promote to headers
	const firstLineEnd = body.indexOf("\r\n")
	const firstLine = firstLineEnd >= 0 ? body.slice(0, firstLineEnd) : body
	if (firstLine.startsWith("Content-Type:")) {
		// Do NOT fold multipart Content-Type headers as boundary must stay intact
		headersArray.push(firstLine)
		const restOfBody = firstLineEnd >= 0 ? body.slice(firstLineEnd + 2) : ""
		return `${headersArray.join("\r\n")}\r\n${restOfBody}`
	}

	return `${headersArray.join("\r\n")}\r\n\r\n${body}`
}

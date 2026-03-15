import { encode } from "../utils"
import type { User } from "./types"

function isAsciiOnly(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i)
		if (code >= 0x7f) return false
		if (code <= 0x1f && code !== 0x09) return false
	}
	return true
}

export function encodeHeader(text: string): string {
	if (isAsciiOnly(text)) {
		return text
	}
	const bytes = encode(text)
	const prefix = "=?UTF-8?Q?"
	const suffix = "?="
	const overhead = prefix.length + suffix.length
	const maxPayload = 75 - overhead

	const words: string[] = []
	let current = ""

	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[i]
		let fragment: string
		if (byte >= 33 && byte <= 126 && byte !== 63 && byte !== 61 && byte !== 95) {
			fragment = String.fromCharCode(byte)
		} else if (byte === 32) {
			fragment = "_"
		} else {
			fragment = `=${byte.toString(16).toUpperCase().padStart(2, "0")}`
		}

		const isUtf8LeadByte = (byte & 0xc0) !== 0x80
		if (current.length + fragment.length > maxPayload && isUtf8LeadByte) {
			words.push(`${prefix}${current}${suffix}`)
			current = fragment
		} else {
			current += fragment
		}
	}
	if (current.length > 0) {
		words.push(`${prefix}${current}${suffix}`)
	}

	return words.join("\r\n ")
}

export function foldHeaderLine(line: string, maxLen = 78): string {
	if (line.includes("\r\n")) {
		const segments = line.split("\r\n")
		return segments.map((segment) => foldHeaderLine(segment, maxLen)).join("\r\n")
	}
	if (line.length <= maxLen) return line

	const parts: string[] = []
	let remaining = line

	while (remaining.length > maxLen) {
		let splitAt = -1
		for (let i = maxLen - 1; i > 0; i--) {
			if (remaining[i] === " " || remaining[i] === "\t" || remaining[i] === ",") {
				splitAt = remaining[i] === "," ? i + 1 : i
				break
			}
		}
		if (splitAt <= 0) {
			splitAt = maxLen
		}
		parts.push(remaining.slice(0, splitAt))
		remaining = remaining.slice(splitAt)
		if (remaining.length > 0 && remaining[0] !== " " && remaining[0] !== "\t") {
			remaining = ` ${remaining}`
		}
	}
	if (remaining.length > 0) {
		parts.push(remaining)
	}
	return parts.join("\r\n")
}

export function resolveHeaders(params: {
	from: User
	to: User[]
	cc?: User[]
	reply?: User
	subject: string
	headers: Record<string, string>
}): void {
	const { from, to, cc, reply, subject, headers } = params

	if (!headers.From) {
		let fromValue = from.email
		if (from.name) {
			fromValue = `"${encodeHeader(from.name)}" <${fromValue}>`
		}
		headers.From = fromValue
	}

	if (!headers.To) {
		const toAddresses = to.map((user) => {
			if (user.name) {
				return `"${encodeHeader(user.name)}" <${user.email}>`
			}
			return user.email
		})
		headers.To = toAddresses.join(", ")
	}

	if (!headers["Reply-To"] && reply) {
		let replyAddress = reply.email
		if (reply.name) {
			replyAddress = `"${encodeHeader(reply.name)}" <${replyAddress}>`
		}
		headers["Reply-To"] = replyAddress
	}

	if (!headers.CC && cc) {
		const ccAddresses = cc.map((user) => {
			if (user.name) {
				return `"${encodeHeader(user.name)}" <${user.email}>`
			}
			return user.email
		})
		headers.CC = ccAddresses.join(", ")
	}

	if (!headers.Subject && subject) {
		headers.Subject = encodeHeader(subject)
	}

	headers.Date = headers.Date ?? new Date().toUTCString()
	headers["Message-ID"] =
		headers["Message-ID"] ?? `<${crypto.randomUUID()}@${from.email.split("@").pop()}>`
}

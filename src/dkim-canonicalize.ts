export type ParsedHeader = {
	name: string
	value: string
}

export function parseHeaders(headerSection: string): ParsedHeader[] {
	const headers: ParsedHeader[] = []
	for (const line of headerSection.split("\r\n")) {
		if (line === "") continue
		if (/^[ \t]/.test(line) && headers.length > 0) {
			headers[headers.length - 1].value += `\r\n${line}`
		} else {
			const colonIdx = line.indexOf(":")
			if (colonIdx === -1) continue
			headers.push({
				name: line.substring(0, colonIdx),
				value: line.substring(colonIdx + 1),
			})
		}
	}
	return headers
}

const DEFAULT_HEADERS = [
	"from",
	"to",
	"subject",
	"date",
	"message-id",
	"mime-version",
	"content-type",
]

const OPTIONAL_HEADERS = ["cc", "reply-to"]

export function selectDefaultHeaders(headers: ParsedHeader[]): string[] {
	const present = new Set(headers.map((h) => h.name.toLowerCase()))
	const selected = DEFAULT_HEADERS.filter((n) => present.has(n))
	for (const name of OPTIONAL_HEADERS) {
		if (present.has(name)) selected.push(name)
	}
	return selected
}

export function canonicalizeRelaxedHeader(name: string, value: string): string {
	const unfolded = value.replace(/\r\n([ \t])/g, "$1")
	const collapsed = unfolded.replace(/[ \t]+/g, " ")
	return `${name.toLowerCase().trim()}:${collapsed.trim()}`
}

export function canonicalizeRelaxedBody(body: string): string {
	if (!body || body === "\r\n") return "\r\n"
	const lines = body.split("\r\n")
	const processed = lines.map((line) => line.replace(/[ \t]+/g, " ").replace(/ +$/, ""))
	while (processed.length > 0 && processed[processed.length - 1] === "") {
		processed.pop()
	}
	if (processed.length === 0) return "\r\n"
	return `${processed.join("\r\n")}\r\n`
}

export function canonicalizeSimpleHeader(name: string, value: string): string {
	return `${name}:${value}`
}

export function canonicalizeSimpleBody(body: string): string {
	if (!body || body === "\r\n") return "\r\n"
	const lines = body.split("\r\n")
	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop()
	}
	if (lines.length === 0) return "\r\n"
	return `${lines.join("\r\n")}\r\n`
}

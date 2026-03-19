/**
 * RFC 8058 One-Click List-Unsubscribe
 * Generates unsubscribe headers
 */

import { CrlfInjectionError } from "./errors"

export type UnsubscribeOptions = {
	/** Unsubscribe URL (HTTPS required, RFC 8058) */
	url: string
	/** mailto: address (optional) */
	mailto?: string
}

export type UnsubscribeHeaders = {
	"List-Unsubscribe": string
	"List-Unsubscribe-Post": string
}

function validateUrl(url: string): void {
	if (/[\r\n]/.test(url)) {
		throw new CrlfInjectionError("List-Unsubscribe URL")
	}
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new Error(`Invalid URL: "${url}"`)
	}
	if (parsed.protocol !== "https:") {
		throw new Error("List-Unsubscribe URL must use HTTPS (RFC 8058)")
	}
}

function validateMailto(mailto: string): void {
	if (/[\r\n]/.test(mailto)) {
		throw new CrlfInjectionError("List-Unsubscribe mailto")
	}
	if (!mailto.includes("@")) {
		throw new Error(`Invalid mailto address: "${mailto}"`)
	}
}

/**
 * Generates RFC 8058 compliant unsubscribe headers
 *
 * @param options - Unsubscribe options (URL or URL+mailto)
 * @returns List-Unsubscribe and List-Unsubscribe-Post headers
 *
 * @example
 * ```typescript
 * const headers = unsubscribeHeaders({ url: "https://example.com/unsub?id=123" })
 * await mailer.send({ ...options, headers })
 * ```
 */
export function unsubscribeHeaders(options: UnsubscribeOptions): UnsubscribeHeaders {
	validateUrl(options.url)

	const values: string[] = []
	if (options.mailto) {
		validateMailto(options.mailto)
		values.push(`<mailto:${options.mailto}>`)
	}
	values.push(`<${options.url}>`)

	return {
		"List-Unsubscribe": values.join(", "),
		"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
	}
}

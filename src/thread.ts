/**
 * RFC 5322 §3.6.4 Reply thread management
 * Generates In-Reply-To / References headers
 */

export type ThreadOptions = {
	/** Message-ID of the message being replied to (e.g., "<abc@example.com>") */
	inReplyTo: string
	/** Existing References chain (space-separated Message-ID list) */
	references?: string
}

export type ThreadHeaders = {
	"In-Reply-To": string
	References: string
}

const MSG_ID_PATTERN = /^<[^>\r\n]+@[^>\r\n]+>$/

function validateMessageId(id: string): void {
	const trimmed = id.trim()
	if (!MSG_ID_PATTERN.test(trimmed)) {
		throw new Error(`Invalid Message-ID format: "${id}". Expected format: <id@domain>`)
	}
}

function validateReferences(refs: string): void {
	if (/[\r\n]/.test(refs)) {
		throw new Error("References must not contain CRLF characters")
	}
	const ids = refs.trim().split(/\s+/)
	for (const id of ids) {
		if (!MSG_ID_PATTERN.test(id)) {
			throw new Error(`Invalid Message-ID in References: "${id}". Expected format: <id@domain>`)
		}
	}
}

/**
 * Generates headers for reply threading
 *
 * @param options - Thread options
 * @returns Object containing In-Reply-To and References headers
 *
 * @example
 * ```typescript
 * const headers = threadHeaders({ inReplyTo: "<abc@example.com>" })
 * await mailer.send({ ...options, headers })
 * ```
 */
export function threadHeaders(options: ThreadOptions): ThreadHeaders {
	const inReplyTo = options.inReplyTo.trim()
	validateMessageId(inReplyTo)

	if (options.references) {
		validateReferences(options.references)
		const refs = options.references.trim()
		return {
			"In-Reply-To": inReplyTo,
			References: `${refs} ${inReplyTo}`,
		}
	}

	return {
		"In-Reply-To": inReplyTo,
		References: inReplyTo,
	}
}

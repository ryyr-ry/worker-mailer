/**
 * RFC 5322 §3.6.4 返信スレッド管理
 * In-Reply-To / References ヘッダーを生成する
 */

export type ThreadOptions = {
	/** 返信先メッセージのMessage-ID（例: "<abc@example.com>"） */
	inReplyTo: string
	/** 既存のReferencesチェーン（スペース区切りのMessage-ID列） */
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
 * 返信スレッド用のヘッダーを生成する
 *
 * @param options - スレッドオプション
 * @returns In-Reply-To と References ヘッダーのオブジェクト
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

/**
 * RFC 8058 One-Click List-Unsubscribe
 * 配信停止ヘッダーを生成する
 */

import { CrlfInjectionError } from "./errors"

export type UnsubscribeOptions = {
	/** 配信停止URL（HTTPSを推奨） */
	url: string
	/** mailto:アドレス（オプション） */
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
	try {
		new URL(url)
	} catch {
		throw new Error(`Invalid URL: "${url}"`)
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
 * RFC 8058 準拠の配信停止ヘッダーを生成する
 *
 * @param options - 配信停止オプション（URLまたはURL+mailto）
 * @returns List-Unsubscribe と List-Unsubscribe-Post ヘッダー
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

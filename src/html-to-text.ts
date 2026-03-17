/**
 * HTMLからプレーンテキストへの変換
 * メールのtext/plain部分を自動生成する
 */

export type HtmlToTextOptions = {
	/** 行の折り返し文字数（falseで折り返し無効、デフォルト: 78） */
	wordwrap?: number | false
	/** リンクのURLを保持するか（デフォルト: true） */
	preserveLinks?: boolean
}

/**
 * HTMLをプレーンテキストに変換する
 *
 * @param html - 変換するHTML文字列
 * @param options - 変換オプション
 * @returns プレーンテキスト
 */
export function htmlToText(html: string, options?: HtmlToTextOptions): string {
	const preserveLinks = options?.preserveLinks ?? true
	const wordwrap = options?.wordwrap ?? 78

	let text = html
	text = stripComments(text)
	text = convertBlockElements(text)
	text = convertLinks(text, preserveLinks)
	text = convertLists(text)
	text = convertHorizontalRules(text)
	text = stripTags(text)
	text = decodeEntities(text)
	text = normalizeWhitespace(text)

	if (wordwrap !== false) {
		text = wrapLines(text, wordwrap)
	}

	return text.trim()
}

function stripComments(html: string): string {
	return html.replace(/<!--[\s\S]*?-->/g, "")
}

function convertBlockElements(html: string): string {
	let text = html
	text = text.replace(/<br\s*\/?>/gi, "\n")
	text = text.replace(/<\/p>/gi, "\n\n")
	text = text.replace(/<\/div>/gi, "\n")
	text = text.replace(/<\/h[1-6]>/gi, "\n\n")
	text = text.replace(/<h[1-6][^>]*>/gi, "\n")
	text = text.replace(/<\/td>/gi, " ")
	text = text.replace(/<\/tr>/gi, "\n")
	text = text.replace(/<\/blockquote>/gi, "\n")
	text = text.replace(/<\/pre>/gi, "\n")
	return text
}

function convertLinks(html: string, preserve: boolean): string {
	if (!preserve) return html
	return html.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, label) => {
		const cleanLabel = label.replace(/<[^>]+>/g, "").trim()
		if (cleanLabel === url || !cleanLabel) return url
		return `${cleanLabel} (${url})`
	})
}

function convertLists(html: string): string {
	let text = html
	text = text.replace(/<li[^>]*>/gi, "- ")
	text = text.replace(/<\/li>/gi, "\n")
	text = text.replace(/<\/?[ou]l[^>]*>/gi, "\n")
	return text
}

function convertHorizontalRules(html: string): string {
	return html.replace(/<hr\s*\/?>/gi, "\n---\n")
}

function stripTags(html: string): string {
	return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, "")
}

function decodeEntities(text: string): string {
	const entities: Record<string, string> = {
		"&amp;": "&",
		"&lt;": "<",
		"&gt;": ">",
		"&quot;": '"',
		"&#39;": "'",
		"&apos;": "'",
		"&nbsp;": " ",
		"&mdash;": "—",
		"&ndash;": "–",
		"&laquo;": "«",
		"&raquo;": "»",
		"&bull;": "•",
		"&hellip;": "…",
		"&copy;": "©",
		"&reg;": "®",
		"&trade;": "™",
	}

	let result = text
	for (const [entity, char] of Object.entries(entities)) {
		result = result.replaceAll(entity, char)
	}
	result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
	result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
		String.fromCharCode(Number.parseInt(hex, 16)),
	)
	return result
}

function normalizeWhitespace(text: string): string {
	let result = text
	result = result.replace(/[ \t]+/g, " ")
	result = result.replace(/ ?\n ?/g, "\n")
	result = result.replace(/\n{3,}/g, "\n\n")
	return result
}

function wrapLines(text: string, width: number): string {
	return text
		.split("\n")
		.map((line) => wrapSingleLine(line, width))
		.join("\n")
}

function wrapSingleLine(line: string, width: number): string {
	if (line.length <= width) return line

	const words = line.split(" ")
	const lines: string[] = []
	let current = ""

	for (const word of words) {
		if (current.length === 0) {
			current = word
		} else if (current.length + 1 + word.length <= width) {
			current += ` ${word}`
		} else {
			lines.push(current)
			current = word
		}
	}
	if (current) lines.push(current)
	return lines.join("\n")
}

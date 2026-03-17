/**
 * Mustache風テンプレートエンジン
 * {{変数}} 形式のプレースホルダーを値に置換する
 */

export type TemplateData = Record<string, unknown>

type CompiledToken =
	| { type: "text"; value: string }
	| { type: "variable"; key: string; escaped: boolean }
	| { type: "section"; key: string; body: CompiledToken[]; inverted: boolean }

/**
 * テンプレートをコンパイルして再利用可能な関数を返す
 *
 * @param template - Mustache風テンプレート文字列
 * @returns データを受け取りレンダリング結果を返す関数
 */
export function compile(template: string): (data: TemplateData) => string {
	const tokens = tokenize(template)
	return (data: TemplateData) => renderTokens(tokens, data)
}

/**
 * テンプレートにデータを適用して文字列を返す
 *
 * @param template - Mustache風テンプレート文字列
 * @param data - 埋め込むデータ
 * @returns レンダリング結果
 */
export function render(template: string, data: TemplateData): string {
	return compile(template)(data)
}

function tokenize(template: string): CompiledToken[] {
	const tokens: CompiledToken[] = []
	let remaining = template

	while (remaining.length > 0) {
		const tagStart = remaining.indexOf("{{")
		if (tagStart === -1) {
			tokens.push({ type: "text", value: remaining })
			break
		}
		if (tagStart > 0) {
			tokens.push({ type: "text", value: remaining.substring(0, tagStart) })
		}
		const tagEnd = remaining.indexOf("}}", tagStart)
		if (tagEnd === -1) {
			tokens.push({ type: "text", value: remaining.substring(tagStart) })
			break
		}
		const content = remaining.substring(tagStart + 2, tagEnd).trim()
		remaining = remaining.substring(tagEnd + 2)
		const result = parseTag(content, remaining)
		tokens.push(result.token)
		remaining = result.remaining
	}
	return tokens
}

function parseTag(
	content: string,
	remaining: string,
): { token: CompiledToken; remaining: string } {
	if (content.startsWith("#") || content.startsWith("^")) {
		const inverted = content.startsWith("^")
		const key = content.substring(1).trim()
		const { body, rest } = extractSection(remaining, key)
		return {
			token: { type: "section", key, body: tokenize(body), inverted },
			remaining: rest,
		}
	}
	if (content.startsWith("{") && remaining.startsWith("}")) {
		const key = content.substring(1).trim()
		return {
			token: { type: "variable", key, escaped: false },
			remaining: remaining.substring(1),
		}
	}
	return {
		token: { type: "variable", key: content, escaped: true },
		remaining,
	}
}

function extractSection(text: string, key: string): { body: string; rest: string } {
	const closeTag = `{{/${key}}}`
	const closeIdx = text.indexOf(closeTag)
	if (closeIdx === -1) {
		return { body: text, rest: "" }
	}
	return {
		body: text.substring(0, closeIdx),
		rest: text.substring(closeIdx + closeTag.length),
	}
}

function renderTokens(tokens: CompiledToken[], data: TemplateData): string {
	return tokens.map((token) => renderToken(token, data)).join("")
}

function renderToken(token: CompiledToken, data: TemplateData): string {
	switch (token.type) {
		case "text":
			return token.value
		case "variable":
			return renderVariable(token.key, token.escaped, data)
		case "section":
			return renderSection(token, data)
	}
}

function renderVariable(key: string, escaped: boolean, data: TemplateData): string {
	const value = resolveValue(key, data)
	if (value === undefined || value === null) return ""
	const str = String(value)
	return escaped ? escapeHtml(str) : str
}

function renderSection(token: CompiledToken & { type: "section" }, data: TemplateData): string {
	const value = resolveValue(token.key, data)
	const isTruthy = isTruthyValue(value)

	if (token.inverted) {
		return isTruthy ? "" : renderTokens(token.body, data)
	}

	if (Array.isArray(value)) {
		return value
			.map((item) => {
				const itemData = typeof item === "object" && item !== null
					? { ...data, ...(item as TemplateData) }
					: { ...data, ".": item }
				return renderTokens(token.body, itemData)
			})
			.join("")
	}

	return isTruthy ? renderTokens(token.body, data) : ""
}

function resolveValue(key: string, data: TemplateData): unknown {
	if (key === ".") return data["."]
	const parts = key.split(".")
	let current: unknown = data
	for (const part of parts) {
		if (current === null || current === undefined) return undefined
		if (typeof current !== "object") return undefined
		current = (current as Record<string, unknown>)[part]
	}
	return current
}

function isTruthyValue(value: unknown): boolean {
	if (value === undefined || value === null || value === false) return false
	if (value === 0 || value === "") return false
	if (Array.isArray(value) && value.length === 0) return false
	return true
}

function escapeHtml(str: string): string {
	return str
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}

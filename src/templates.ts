// ---------------------------------------------------------------------------
// HTMLメールテンプレートモジュール
// メールクライアント互換のHTMLメールを簡単に生成するヘルパー群
// ---------------------------------------------------------------------------

// ── 共通オプション型 ──────────────────────────────────────────────────────────

export type EmailTemplateOptions = {
	brandName?: string
	brandColor?: string
	footer?: string
	logoUrl?: string
}

// ── 各テンプレート固有の引数型 ────────────────────────────────────────────────

export type VerificationOptions = EmailTemplateOptions & {
	title: string
	message: string
	code?: string
	buttonText?: string
	buttonUrl?: string
}

export type PasswordResetOptions = EmailTemplateOptions & {
	title: string
	message: string
	buttonText: string
	buttonUrl: string
	expiresIn?: string
}

export type NotificationOptions = EmailTemplateOptions & {
	title: string
	message: string
	actions?: ReadonlyArray<{ text: string; url: string }>
}

export type SimpleOptions = EmailTemplateOptions & {
	title: string
	body: string
}

// ── HTMLエスケープ（XSS対策） ─────────────────────────────────────────────────

const HTML_ESCAPE_MAP: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#x27;",
}

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch)
}

// ── デフォルト定数 ────────────────────────────────────────────────────────────

const DEFAULT_BRAND_COLOR = "#5865F2"
const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// ── ベースレイアウト ──────────────────────────────────────────────────────────

export function baseLayout(
	title: string,
	content: string,
	options: EmailTemplateOptions = {},
): string {
	const brandColor = options.brandColor ?? DEFAULT_BRAND_COLOR
	const brandName = options.brandName ? escapeHtml(options.brandName) : ""
	const footer = options.footer ? escapeHtml(options.footer) : ""
	const escapedTitle = escapeHtml(title)

	const logoHtml = options.logoUrl
		? `<img src="${escapeHtml(options.logoUrl)}" alt="${brandName}" width="40" height="40" style="display:block;border:0;outline:none;" />`
		: ""

	const headerContent =
		logoHtml || brandName
			? [
					logoHtml,
					brandName
						? `<span style="font-size:20px;font-weight:700;color:#ffffff;">${brandName}</span>`
						: "",
				]
					.filter(Boolean)
					.join("&nbsp;&nbsp;")
			: ""

	const headerRow = headerContent
		? `<tr><td style="background-color:${escapeHtml(brandColor)};padding:24px 32px;text-align:center;border-radius:8px 8px 0 0;">${headerContent}</td></tr>`
		: ""

	const footerRow = footer
		? `<tr><td style="padding:24px 32px;text-align:center;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">${footer}</td></tr>`
		: ""

	return (
		"<!DOCTYPE html>" +
		'<html lang="en" xmlns="http://www.w3.org/1999/xhtml">' +
		"<head>" +
		'<meta charset="UTF-8" />' +
		'<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
		'<meta name="color-scheme" content="light dark" />' +
		'<meta name="supported-color-schemes" content="light dark" />' +
		`<title>${escapedTitle}</title>` +
		"<!--[if mso]>" +
		"<noscript>" +
		"<xml>" +
		"<o:OfficeDocumentSettings>" +
		"<o:PixelsPerInch>96</o:PixelsPerInch>" +
		"</o:OfficeDocumentSettings>" +
		"</xml>" +
		"</noscript>" +
		"<![endif]-->" +
		"<style>" +
		"@media (prefers-color-scheme: dark) {" +
		".email-body { background-color: #1a1a2e !important; }" +
		".email-card { background-color: #16213e !important; }" +
		".email-text { color: #e0e0e0 !important; }" +
		".email-heading { color: #ffffff !important; }" +
		".email-footer { color: #9ca3af !important; }" +
		"}" +
		"</style>" +
		"</head>" +
		'<body style="margin:0;padding:0;background-color:#f3f4f6;' +
		`font-family:${FONT_STACK};" class="email-body">` +
		'<table role="presentation" cellpadding="0" cellspacing="0" ' +
		'width="100%" border="0" style="background-color:#f3f4f6;">' +
		'<tr><td align="center" style="padding:40px 16px;">' +
		'<table role="presentation" cellpadding="0" cellspacing="0" ' +
		'width="600" border="0" style="max-width:600px;width:100%;' +
		"background-color:#ffffff;border-radius:8px;overflow:hidden;" +
		'box-shadow:0 1px 3px rgba(0,0,0,0.1);" class="email-card">' +
		headerRow +
		'<tr><td style="padding:32px;">' +
		content +
		"</td></tr>" +
		footerRow +
		"</table>" +
		"</td></tr>" +
		"</table>" +
		"</body>" +
		"</html>"
	)
}

// ── ボタンHTML生成（共通） ────────────────────────────────────────────────────

function buttonHtml(text: string, url: string, brandColor: string = DEFAULT_BRAND_COLOR): string {
	return (
		'<table role="presentation" cellpadding="0" cellspacing="0" ' +
		'border="0" style="margin:24px auto;">' +
		'<tr><td align="center" style="border-radius:6px;' +
		`background-color:${escapeHtml(brandColor)};` +
		'">' +
		`<a href="${escapeHtml(url)}" target="_blank" ` +
		'style="display:inline-block;padding:14px 32px;font-size:16px;' +
		`font-weight:600;color:#ffffff;text-decoration:none;font-family:${FONT_STACK};` +
		`background-color:${escapeHtml(brandColor)};border-radius:6px;` +
		'">' +
		escapeHtml(text) +
		"</a>" +
		"</td></tr>" +
		"</table>"
	)
}

// ── 確認コードHTML生成 ────────────────────────────────────────────────────────

function codeBlockHtml(code: string): string {
	return (
		'<table role="presentation" cellpadding="0" cellspacing="0" ' +
		'border="0" style="margin:24px auto;">' +
		'<tr><td style="padding:16px 40px;background-color:#f3f4f6;' +
		"border-radius:8px;text-align:center;letter-spacing:8px;" +
		`font-size:32px;font-weight:700;font-family:'Courier New',monospace;` +
		`color:#1f2937;">` +
		escapeHtml(code) +
		"</td></tr>" +
		"</table>"
	)
}

// ── 組み込みテンプレート関数群 ────────────────────────────────────────────────

function verification(options: VerificationOptions): string {
	const brandColor = options.brandColor ?? DEFAULT_BRAND_COLOR

	let body =
		'<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;' +
		`color:#1f2937;font-family:${FONT_STACK};" class="email-heading">` +
		escapeHtml(options.title) +
		"</h1>" +
		'<p style="margin:0 0 8px;font-size:16px;line-height:1.6;' +
		`color:#374151;font-family:${FONT_STACK};" class="email-text">` +
		escapeHtml(options.message) +
		"</p>"

	if (options.code) {
		body += codeBlockHtml(options.code)
	}

	if (options.buttonText && options.buttonUrl) {
		body += buttonHtml(options.buttonText, options.buttonUrl, brandColor)
	}

	return baseLayout(options.title, body, options)
}

function passwordReset(options: PasswordResetOptions): string {
	const brandColor = options.brandColor ?? DEFAULT_BRAND_COLOR

	let body =
		'<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;' +
		`color:#1f2937;font-family:${FONT_STACK};" class="email-heading">` +
		escapeHtml(options.title) +
		"</h1>" +
		'<p style="margin:0 0 8px;font-size:16px;line-height:1.6;' +
		`color:#374151;font-family:${FONT_STACK};" class="email-text">` +
		escapeHtml(options.message) +
		"</p>"

	body += buttonHtml(options.buttonText, options.buttonUrl, brandColor)

	if (options.expiresIn) {
		body +=
			'<p style="margin:16px 0 0;font-size:14px;color:#6b7280;' +
			`text-align:center;font-family:${FONT_STACK};" class="email-text">` +
			`このリンクの有効期限: ${escapeHtml(options.expiresIn)}` +
			"</p>"
	}

	return baseLayout(options.title, body, options)
}

function notification(options: NotificationOptions): string {
	const brandColor = options.brandColor ?? DEFAULT_BRAND_COLOR

	let body =
		'<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;' +
		`color:#1f2937;font-family:${FONT_STACK};" class="email-heading">` +
		escapeHtml(options.title) +
		"</h1>" +
		'<p style="margin:0 0 8px;font-size:16px;line-height:1.6;' +
		`color:#374151;font-family:${FONT_STACK};" class="email-text">` +
		escapeHtml(options.message) +
		"</p>"

	if (options.actions && options.actions.length > 0) {
		for (const action of options.actions) {
			body += buttonHtml(action.text, action.url, brandColor)
		}
	}

	return baseLayout(options.title, body, options)
}

function simple(options: SimpleOptions): string {
	const body =
		'<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;' +
		`color:#1f2937;font-family:${FONT_STACK};" class="email-heading">` +
		escapeHtml(options.title) +
		"</h1>" +
		'<p style="margin:0 0 8px;font-size:16px;line-height:1.6;' +
		`color:#374151;font-family:${FONT_STACK};white-space:pre-line;" class="email-text">` +
		escapeHtml(options.body) +
		"</p>"

	return baseLayout(options.title, body, options)
}

export const EmailTemplate = {
	verification,
	passwordReset,
	notification,
	simple,
} as const

// ── html テンプレートリテラルタグ ─────────────────────────────────────────────

const TAG_TRANSFORMS: ReadonlyArray<{
	pattern: RegExp
	replace: (match: string, ...groups: string[]) => string
}> = [
	{
		pattern: /<heading>([\s\S]*?)<\/heading>/g,
		replace: (_match: string, inner: string) =>
			`<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#1f2937;font-family:${FONT_STACK};" class="email-heading">${inner}</h1>`,
	},
	{
		pattern: /<text>([\s\S]*?)<\/text>/g,
		replace: (_match: string, inner: string) =>
			`<p style="margin:0 0 8px;font-size:16px;line-height:1.6;color:#374151;font-family:${FONT_STACK};" class="email-text">${inner}</p>`,
	},
	{
		pattern: /<bold>([\s\S]*?)<\/bold>/g,
		replace: (_match: string, inner: string) => `<strong>${inner}</strong>`,
	},
	{
		pattern: /<button\s+href="([^"]*)">([\s\S]*?)<\/button>/g,
		replace: (_match: string, url: string, text: string) =>
			`<a href="${url}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;font-family:${FONT_STACK};background-color:${DEFAULT_BRAND_COLOR};border-radius:6px;">${text}</a>`,
	},
	{
		pattern: /<divider\s*\/>/g,
		replace: () => '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />',
	},
	{
		pattern: /<spacer\s*\/>/g,
		replace: () => '<div style="height:20px;"></div>',
	},
]

export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	let raw = strings[0]
	for (let i = 0; i < values.length; i++) {
		raw += String(values[i])
		raw += strings[i + 1]
	}

	let result = raw
	for (const transform of TAG_TRANSFORMS) {
		result = result.replace(transform.pattern, transform.replace as (...args: string[]) => string)
	}

	return result
}

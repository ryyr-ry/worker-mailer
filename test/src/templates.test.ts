import { describe, expect, it } from "vitest"
import type {
	EmailTemplateOptions,
	NotificationOptions,
	PasswordResetOptions,
	SimpleOptions,
	VerificationOptions,
} from "../../src/templates"
import { baseLayout, EmailTemplate, escapeHtml, html } from "../../src/templates"

// ── escapeHtml ───────────────────────────────────────────────────────────────

describe("escapeHtml", () => {
	it("HTMLの特殊文字をエスケープすること", () => {
		expect(escapeHtml("&")).toBe("&amp;")
		expect(escapeHtml("<")).toBe("&lt;")
		expect(escapeHtml(">")).toBe("&gt;")
		expect(escapeHtml('"')).toBe("&quot;")
		expect(escapeHtml("'")).toBe("&#x27;")
	})

	it("複数の特殊文字を一度にエスケープすること", () => {
		expect(escapeHtml('<script>alert("xss")</script>')).toBe(
			"&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
		)
	})

	it("特殊文字を含まない文字列をそのまま返すこと", () => {
		expect(escapeHtml("Hello World")).toBe("Hello World")
		expect(escapeHtml("こんにちは")).toBe("こんにちは")
	})

	it("空文字列をそのまま返すこと", () => {
		expect(escapeHtml("")).toBe("")
	})
})

// ── baseLayout ───────────────────────────────────────────────────────────────

describe("baseLayout", () => {
	it("DOCTYPE宣言とhtml/head/bodyタグを含むこと", () => {
		const result = baseLayout("Test", "<p>content</p>")
		expect(result).toContain("<!DOCTYPE html>")
		expect(result).toContain("<html")
		expect(result).toContain("<head>")
		expect(result).toContain("<body")
		expect(result).toContain("</html>")
	})

	it("titleタグにタイトルが含まれること", () => {
		const result = baseLayout("My Title", "<p>content</p>")
		expect(result).toContain("<title>My Title</title>")
	})

	it("タイトルがHTMLエスケープされること", () => {
		const result = baseLayout('<script>alert("xss")</script>', "<p>content</p>")
		expect(result).toContain("<title>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</title>")
		expect(result).not.toContain("<script>alert")
	})

	it("テーブルレイアウトを使用すること", () => {
		const result = baseLayout("Test", "<p>content</p>")
		expect(result).toContain('role="presentation"')
		expect(result).toContain("cellpadding")
		expect(result).toContain("cellspacing")
	})

	it("max-width:600pxの幅制限があること", () => {
		const result = baseLayout("Test", "<p>content</p>")
		expect(result).toContain("max-width:600px")
	})

	it("インラインCSSを使用すること", () => {
		const result = baseLayout("Test", "<p>content</p>")
		expect(result).toContain('style="')
	})

	it("ダークモード対応のmetaタグとCSSを含むこと", () => {
		const result = baseLayout("Test", "<p>content</p>")
		expect(result).toContain('name="color-scheme"')
		expect(result).toContain("prefers-color-scheme: dark")
	})

	it("Outlook条件付きコメントを含むこと", () => {
		const result = baseLayout("Test", "<p>content</p>")
		expect(result).toContain("<!--[if mso]>")
		expect(result).toContain("<![endif]-->")
	})

	it("system-uiフォントスタックを使用すること", () => {
		const result = baseLayout("Test", "<p>content</p>")
		expect(result).toContain("system-ui")
		expect(result).toContain("-apple-system")
		expect(result).toContain("sans-serif")
	})

	it("brandNameが指定された場合ヘッダーに表示すること", () => {
		const result = baseLayout("Test", "<p>content</p>", {
			brandName: "MyApp",
		})
		expect(result).toContain("MyApp")
	})

	it("brandColorが指定された場合そのカラーを使用すること", () => {
		const result = baseLayout("Test", "<p>content</p>", {
			brandName: "MyApp",
			brandColor: "#ff0000",
		})
		expect(result).toContain("#ff0000")
	})

	it("brandColorのデフォルトは#5865F2であること", () => {
		const result = baseLayout("Test", "<p>content</p>", {
			brandName: "MyApp",
		})
		expect(result).toContain("#5865F2")
	})

	it("footerが指定された場合フッターに表示すること", () => {
		const result = baseLayout("Test", "<p>content</p>", {
			footer: "© 2024 MyApp",
		})
		expect(result).toContain("© 2024 MyApp")
	})

	it("logoUrlが指定された場合imgタグを出力すること", () => {
		const result = baseLayout("Test", "<p>content</p>", {
			logoUrl: "https://example.com/logo.png",
			brandName: "MyApp",
		})
		expect(result).toContain('<img src="https://example.com/logo.png"')
		expect(result).toContain('alt="MyApp"')
		expect(result).toContain("width=")
		expect(result).toContain("height=")
	})

	it("オプション未指定でもヘッダー・フッターなしで動作すること", () => {
		const result = baseLayout("Test", "<p>content</p>")
		expect(result).toContain("<!DOCTYPE html>")
		expect(result).toContain("<p>content</p>")
	})

	it("コンテンツがそのまま出力されること", () => {
		const content = '<table><tr><td style="color:red;">Hello</td></tr></table>'
		const result = baseLayout("Test", content)
		expect(result).toContain(content)
	})
})

// ── EmailTemplate.verification ───────────────────────────────────────────────

describe("EmailTemplate.verification", () => {
	const baseOptions: VerificationOptions = {
		title: "メール確認",
		message: "以下のコードを入力してください。",
	}

	it("HTML文字列を返すこと", () => {
		const result = EmailTemplate.verification(baseOptions)
		expect(typeof result).toBe("string")
		expect(result).toContain("<!DOCTYPE html>")
	})

	it("タイトルとメッセージが含まれること", () => {
		const result = EmailTemplate.verification(baseOptions)
		expect(result).toContain("メール確認")
		expect(result).toContain("以下のコードを入力してください。")
	})

	it("確認コードが指定された場合表示されること", () => {
		const result = EmailTemplate.verification({
			...baseOptions,
			code: "123456",
		})
		expect(result).toContain("123456")
	})

	it("ボタンが指定された場合リンクが含まれること", () => {
		const result = EmailTemplate.verification({
			...baseOptions,
			buttonText: "確認する",
			buttonUrl: "https://example.com/verify",
		})
		expect(result).toContain("確認する")
		expect(result).toContain("https://example.com/verify")
		expect(result).toContain("<a ")
		expect(result).toContain("href=")
	})

	it("ボタン未指定の場合はボタンを含まないこと", () => {
		const result = EmailTemplate.verification(baseOptions)
		expect(result).not.toContain("https://example.com/verify")
	})

	it("XSS攻撃文字列がエスケープされること", () => {
		const result = EmailTemplate.verification({
			title: '<img src=x onerror="alert(1)">',
			message: "<script>document.cookie</script>",
		})
		expect(result).not.toContain('<img src=x onerror="alert(1)">')
		expect(result).not.toContain("<script>document.cookie</script>")
		expect(result).toContain("&lt;img src=x onerror=")
		expect(result).toContain("&lt;script&gt;")
	})

	it("codeの値もエスケープされること", () => {
		const result = EmailTemplate.verification({
			...baseOptions,
			code: '<img src=x onerror="alert(1)">',
		})
		expect(result).not.toContain('<img src=x onerror="alert(1)">')
		expect(result).toContain("&lt;img")
	})

	it("brandNameとbrandColorが適用されること", () => {
		const result = EmailTemplate.verification({
			...baseOptions,
			brandName: "TestBrand",
			brandColor: "#00ff00",
		})
		expect(result).toContain("TestBrand")
		expect(result).toContain("#00ff00")
	})
})

// ── EmailTemplate.passwordReset ──────────────────────────────────────────────

describe("EmailTemplate.passwordReset", () => {
	const baseOptions: PasswordResetOptions = {
		title: "パスワードリセット",
		message: "以下のボタンからパスワードをリセットしてください。",
		buttonText: "パスワードをリセット",
		buttonUrl: "https://example.com/reset?token=abc123",
	}

	it("HTML文字列を返すこと", () => {
		const result = EmailTemplate.passwordReset(baseOptions)
		expect(typeof result).toBe("string")
		expect(result).toContain("<!DOCTYPE html>")
	})

	it("タイトル・メッセージ・ボタンが含まれること", () => {
		const result = EmailTemplate.passwordReset(baseOptions)
		expect(result).toContain("パスワードリセット")
		expect(result).toContain("以下のボタンからパスワードをリセットしてください。")
		expect(result).toContain("パスワードをリセット")
		expect(result).toContain("https://example.com/reset?token=abc123")
	})

	it("ボタンがaタグで実装されていること", () => {
		const result = EmailTemplate.passwordReset(baseOptions)
		expect(result).toContain("<a ")
		expect(result).toContain("href=")
		expect(result).not.toContain("<button")
	})

	it("有効期限が指定された場合表示されること", () => {
		const result = EmailTemplate.passwordReset({
			...baseOptions,
			expiresIn: "30分",
		})
		expect(result).toContain("30分")
	})

	it("有効期限が未指定の場合表示されないこと", () => {
		const result = EmailTemplate.passwordReset(baseOptions)
		expect(result).not.toContain("有効期限")
	})

	it("XSS攻撃文字列がエスケープされること", () => {
		const result = EmailTemplate.passwordReset({
			title: '<script>alert("xss")</script>',
			message: "normal message",
			buttonText: "Reset",
			buttonUrl: "https://example.com/reset",
		})
		expect(result).not.toContain("<script>alert")
		expect(result).toContain("&lt;script&gt;")
	})

	it("buttonUrlのXSS攻撃がエスケープされること", () => {
		const result = EmailTemplate.passwordReset({
			...baseOptions,
			buttonUrl: 'javascript:alert("xss")',
		})
		expect(result).not.toContain('javascript:alert("xss")')
		expect(result).toContain("&quot;xss&quot;")
	})
})

// ── EmailTemplate.notification ───────────────────────────────────────────────

describe("EmailTemplate.notification", () => {
	const baseOptions: NotificationOptions = {
		title: "新着通知",
		message: "新しいメッセージが届きました。",
	}

	it("HTML文字列を返すこと", () => {
		const result = EmailTemplate.notification(baseOptions)
		expect(typeof result).toBe("string")
		expect(result).toContain("<!DOCTYPE html>")
	})

	it("タイトルとメッセージが含まれること", () => {
		const result = EmailTemplate.notification(baseOptions)
		expect(result).toContain("新着通知")
		expect(result).toContain("新しいメッセージが届きました。")
	})

	it("アクションボタンが複数表示されること", () => {
		const result = EmailTemplate.notification({
			...baseOptions,
			actions: [
				{ text: "確認する", url: "https://example.com/view" },
				{ text: "返信する", url: "https://example.com/reply" },
			],
		})
		expect(result).toContain("確認する")
		expect(result).toContain("https://example.com/view")
		expect(result).toContain("返信する")
		expect(result).toContain("https://example.com/reply")
	})

	it("アクション未指定の場合ボタンを含まないこと", () => {
		const result = EmailTemplate.notification(baseOptions)
		expect(result).not.toContain("https://example.com/view")
	})

	it("空のactionsでもエラーにならないこと", () => {
		const result = EmailTemplate.notification({
			...baseOptions,
			actions: [],
		})
		expect(result).toContain("<!DOCTYPE html>")
	})

	it("XSS攻撃がactionsでもエスケープされること", () => {
		const result = EmailTemplate.notification({
			...baseOptions,
			actions: [
				{
					text: '<script>alert("xss")</script>',
					url: "https://example.com",
				},
			],
		})
		expect(result).not.toContain("<script>alert")
		expect(result).toContain("&lt;script&gt;")
	})
})

// ── EmailTemplate.simple ─────────────────────────────────────────────────────

describe("EmailTemplate.simple", () => {
	const baseOptions: SimpleOptions = {
		title: "お知らせ",
		body: "これはシンプルなテキストメールです。",
	}

	it("HTML文字列を返すこと", () => {
		const result = EmailTemplate.simple(baseOptions)
		expect(typeof result).toBe("string")
		expect(result).toContain("<!DOCTYPE html>")
	})

	it("タイトルと本文が含まれること", () => {
		const result = EmailTemplate.simple(baseOptions)
		expect(result).toContain("お知らせ")
		expect(result).toContain("これはシンプルなテキストメールです。")
	})

	it("white-space:pre-lineでテキストの改行を保持すること", () => {
		const result = EmailTemplate.simple(baseOptions)
		expect(result).toContain("white-space:pre-line")
	})

	it("XSS攻撃がエスケープされること", () => {
		const result = EmailTemplate.simple({
			title: "Normal",
			body: "<script>document.cookie</script>",
		})
		expect(result).not.toContain("<script>document.cookie</script>")
		expect(result).toContain("&lt;script&gt;")
	})

	it("フッターとブランド名が適用されること", () => {
		const result = EmailTemplate.simple({
			...baseOptions,
			brandName: "TestApp",
			footer: "Copyright 2024",
		})
		expect(result).toContain("TestApp")
		expect(result).toContain("Copyright 2024")
	})
})

// ── html テンプレートリテラルタグ ─────────────────────────────────────────────

describe("html テンプレートリテラルタグ", () => {
	it("<heading>タグをh1に変換すること", () => {
		const result = html`<heading>タイトル</heading>`
		expect(result).toContain("<h1")
		expect(result).toContain("タイトル")
		expect(result).toContain("</h1>")
		expect(result).not.toContain("<heading>")
	})

	it("<text>タグをpに変換すること", () => {
		const result = html`<text>本文テキスト</text>`
		expect(result).toContain("<p")
		expect(result).toContain("本文テキスト")
		expect(result).toContain("</p>")
		expect(result).not.toContain("<text>")
	})

	it("<bold>タグをstrongに変換すること", () => {
		const result = html`<bold>強調テキスト</bold>`
		expect(result).toContain("<strong>強調テキスト</strong>")
		expect(result).not.toContain("<bold>")
	})

	it("<button>タグをaリンクに変換すること", () => {
		const result = html`<button href="https://example.com">クリック</button>`
		expect(result).toContain("<a ")
		expect(result).toContain('href="https://example.com"')
		expect(result).toContain("クリック")
		expect(result).toContain("</a>")
		expect(result).not.toContain("<button")
	})

	it("変換されたボタンにインラインスタイルが含まれること", () => {
		const result = html`<button href="https://example.com">Click</button>`
		expect(result).toContain("display:inline-block")
		expect(result).toContain("text-decoration:none")
		expect(result).toContain("#5865F2")
	})

	it("<divider />をhrに変換すること", () => {
		const result = html`<divider />`
		expect(result).toContain("<hr")
		expect(result).toContain("border-top:")
		expect(result).not.toContain("<divider")
	})

	it("<spacer />を空divに変換すること", () => {
		const result = html`<spacer />`
		expect(result).toContain("height:20px")
		expect(result).not.toContain("<spacer")
	})

	it("複数のタグを同時に変換できること", () => {
		const result = html`<heading>タイトル</heading><spacer /><text>本文</text><divider /><button href="https://example.com">ボタン</button>`
		expect(result).toContain("<h1")
		expect(result).toContain("<p")
		expect(result).toContain("<a ")
		expect(result).toContain("<hr")
		expect(result).toContain("height:20px")
		expect(result).not.toContain("<heading>")
		expect(result).not.toContain("<text>")
		expect(result).not.toContain("<button")
	})

	it("テンプレートリテラルの埋め込み式が展開されること", () => {
		const name = "太郎"
		const url = "https://example.com"
		const result = html`<heading>こんにちは ${name}</heading><button href="${url}">確認</button>`
		expect(result).toContain("こんにちは 太郎")
		expect(result).toContain(`href="${url}"`)
	})

	it("変換対象外のHTMLはそのまま残ること", () => {
		const result = html`<div class="custom">保持されるHTML</div>`
		expect(result).toContain('<div class="custom">保持されるHTML</div>')
	})

	it("数値の埋め込み式が正しく変換されること", () => {
		const count = 42
		const result = html`<text>通知が ${count} 件あります</text>`
		expect(result).toContain("通知が 42 件あります")
	})

	it("補間値にHTMLタグが含まれる場合エスケープされること", () => {
		const userInput = '<script>alert("xss")</script>'
		const result = html`<text>${userInput}</text>`
		expect(result).not.toContain("<script>")
		expect(result).toContain("&lt;script&gt;")
		expect(result).toContain("&lt;/script&gt;")
	})

	it("補間値の&や引用符がエスケープされること", () => {
		const input = "Tom & Jerry \"friends\" 'forever'"
		const result = html`<text>${input}</text>`
		expect(result).toContain("Tom &amp; Jerry &quot;friends&quot; &#x27;forever&#x27;")
	})

	it("補間値に特殊文字がない場合はそのまま出力されること", () => {
		const name = "太郎"
		const result = html`<heading>こんにちは ${name}</heading>`
		expect(result).toContain("こんにちは 太郎")
	})

	it("テンプレートリテラルの静的部分はエスケープされないこと", () => {
		const result = html`<heading>タイトル</heading>`
		expect(result).toContain("<h1")
		expect(result).toContain("</h1>")
	})
})

// ── デフォルト値のテスト ─────────────────────────────────────────────────────

describe("デフォルト値", () => {
	it("brandColorのデフォルトが#5865F2であること", () => {
		const result = EmailTemplate.verification({
			title: "Test",
			message: "Test",
			brandName: "App",
			buttonText: "Click",
			buttonUrl: "https://example.com",
		})
		expect(result).toContain("#5865F2")
	})

	it("カスタムbrandColorが優先されること", () => {
		const result = EmailTemplate.notification({
			title: "Test",
			message: "Test",
			brandName: "App",
			brandColor: "#e74c3c",
			actions: [{ text: "Go", url: "https://example.com" }],
		})
		expect(result).toContain("#e74c3c")
	})
})

// ── HTMLメール構造の検証 ─────────────────────────────────────────────────────

describe("HTMLメール構造の検証", () => {
	it("全テンプレートがtableレイアウトを使用すること", () => {
		const templates = [
			EmailTemplate.verification({ title: "T", message: "M" }),
			EmailTemplate.passwordReset({
				title: "T",
				message: "M",
				buttonText: "B",
				buttonUrl: "https://example.com",
			}),
			EmailTemplate.notification({ title: "T", message: "M" }),
			EmailTemplate.simple({ title: "T", body: "B" }),
		]
		for (const output of templates) {
			expect(output).toContain("<table")
			expect(output).toContain("</table>")
			expect(output).toContain("<tr>")
			expect(output).toContain("<td")
		}
	})

	it("全テンプレートでボタンにbuttonタグを使わないこと", () => {
		const withButtons = [
			EmailTemplate.verification({
				title: "T",
				message: "M",
				buttonText: "B",
				buttonUrl: "https://example.com",
			}),
			EmailTemplate.passwordReset({
				title: "T",
				message: "M",
				buttonText: "B",
				buttonUrl: "https://example.com",
			}),
			EmailTemplate.notification({
				title: "T",
				message: "M",
				actions: [{ text: "Go", url: "https://example.com" }],
			}),
		]
		for (const output of withButtons) {
			expect(output).not.toMatch(/<button[\s>]/)
			expect(output).toContain("<a ")
		}
	})

	it("全テンプレートがviewport metaを含むこと", () => {
		const result = EmailTemplate.simple({ title: "T", body: "B" })
		expect(result).toContain('name="viewport"')
	})

	it("全テンプレートがcharset metaを含むこと", () => {
		const result = EmailTemplate.simple({ title: "T", body: "B" })
		expect(result).toContain('charset="UTF-8"')
	})
})

// ── 型チェック（コンパイル時の型安全性確認用） ─────────────────────────────────

describe("型の互換性", () => {
	it("EmailTemplateOptionsが全テンプレートに渡せること", () => {
		const commonOpts: EmailTemplateOptions = {
			brandName: "Brand",
			brandColor: "#000000",
			footer: "Footer text",
			logoUrl: "https://example.com/logo.png",
		}

		expect(() =>
			EmailTemplate.verification({
				title: "T",
				message: "M",
				...commonOpts,
			}),
		).not.toThrow()

		expect(() =>
			EmailTemplate.passwordReset({
				title: "T",
				message: "M",
				buttonText: "B",
				buttonUrl: "https://example.com",
				...commonOpts,
			}),
		).not.toThrow()

		expect(() =>
			EmailTemplate.notification({
				title: "T",
				message: "M",
				...commonOpts,
			}),
		).not.toThrow()

		expect(() =>
			EmailTemplate.simple({
				title: "T",
				body: "B",
				...commonOpts,
			}),
		).not.toThrow()
	})
})

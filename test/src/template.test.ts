import { describe, expect, it } from "vitest"
import { compile, render } from "../../src/template"

describe("render", () => {
	describe("基本変数置換", () => {
		it("単純な変数を置換する", () => {
			expect(render("Hello {{name}}!", { name: "World" })).toBe("Hello World!")
		})

		it("複数の変数を置換する", () => {
			expect(render("{{greeting}} {{name}}!", { greeting: "Hi", name: "Alice" })).toBe(
				"Hi Alice!",
			)
		})

		it("同じ変数を複数回置換する", () => {
			expect(render("{{x}} and {{x}}", { x: "A" })).toBe("A and A")
		})

		it("未定義の変数を空文字に置換する", () => {
			expect(render("Hello {{name}}!", {})).toBe("Hello !")
		})

		it("nullの変数を空文字に置換する", () => {
			expect(render("Hello {{name}}!", { name: null })).toBe("Hello !")
		})

		it("数値を文字列に変換する", () => {
			expect(render("Count: {{count}}", { count: 42 })).toBe("Count: 42")
		})

		it("booleanを文字列に変換する", () => {
			expect(render("Active: {{active}}", { active: true })).toBe("Active: true")
		})
	})

	describe("HTMLエスケープ", () => {
		it("{{変数}}はHTMLエスケープされる", () => {
			expect(render("{{html}}", { html: "<b>bold</b>" })).toBe("&lt;b&gt;bold&lt;/b&gt;")
		})

		it("&をエスケープする", () => {
			expect(render("{{text}}", { text: "A & B" })).toBe("A &amp; B")
		})

		it("引用符をエスケープする", () => {
			expect(render('{{text}}', { text: 'He said "hello"' })).toBe(
				"He said &quot;hello&quot;",
			)
		})

		it("{{{変数}}}はエスケープされない", () => {
			expect(render("{{{html}}}", { html: "<b>bold</b>" })).toBe("<b>bold</b>")
		})
	})

	describe("ドットパス解決", () => {
		it("ネストしたオブジェクトにアクセスする", () => {
			expect(render("{{user.name}}", { user: { name: "Alice" } })).toBe("Alice")
		})

		it("深くネストしたパスにアクセスする", () => {
			const data = { a: { b: { c: "deep" } } }
			expect(render("{{a.b.c}}", data)).toBe("deep")
		})

		it("存在しないパスを空文字に置換する", () => {
			expect(render("{{user.name}}", { user: {} })).toBe("")
		})

		it("中間パスがnullの場合空文字に置換する", () => {
			expect(render("{{user.name}}", { user: null })).toBe("")
		})
	})

	describe("セクション（条件ブロック）", () => {
		it("truthy値でセクションをレンダリングする", () => {
			expect(render("{{#show}}Visible{{/show}}", { show: true })).toBe("Visible")
		})

		it("falsy値でセクションをスキップする", () => {
			expect(render("{{#show}}Visible{{/show}}", { show: false })).toBe("")
		})

		it("null値でセクションをスキップする", () => {
			expect(render("{{#show}}Visible{{/show}}", { show: null })).toBe("")
		})

		it("空文字でセクションをスキップする", () => {
			expect(render("{{#show}}Visible{{/show}}", { show: "" })).toBe("")
		})

		it("0でセクションをスキップする", () => {
			expect(render("{{#show}}Visible{{/show}}", { show: 0 })).toBe("")
		})

		it("空配列でセクションをスキップする", () => {
			expect(render("{{#items}}Item{{/items}}", { items: [] })).toBe("")
		})
	})

	describe("反転セクション", () => {
		it("falsy値で反転セクションをレンダリングする", () => {
			expect(render("{{^show}}Hidden{{/show}}", { show: false })).toBe("Hidden")
		})

		it("truthy値で反転セクションをスキップする", () => {
			expect(render("{{^show}}Hidden{{/show}}", { show: true })).toBe("")
		})

		it("未定義値で反転セクションをレンダリングする", () => {
			expect(render("{{^missing}}Default{{/missing}}", {})).toBe("Default")
		})
	})

	describe("配列イテレーション", () => {
		it("オブジェクト配列を反復する", () => {
			const data = { items: [{ name: "A" }, { name: "B" }, { name: "C" }] }
			expect(render("{{#items}}{{name}} {{/items}}", data)).toBe("A B C ")
		})

		it("プリミティブ配列を反復する", () => {
			const data = { items: [1, 2, 3] }
			expect(render("{{#items}}{{.}} {{/items}}", data)).toBe("1 2 3 ")
		})

		it("空配列で何も出力しない", () => {
			expect(render("{{#items}}{{name}}{{/items}}", { items: [] })).toBe("")
		})

		it("配列内でも親スコープにアクセスできる", () => {
			const data = { prefix: "Item", items: [{ name: "A" }] }
			expect(render("{{#items}}{{prefix}}: {{name}}{{/items}}", data)).toBe("Item: A")
		})
	})

	describe("空白処理", () => {
		it("変数名前後の空白を無視する", () => {
			expect(render("{{ name }}", { name: "Alice" })).toBe("Alice")
		})

		it("セクションキー前後の空白を無視する", () => {
			expect(render("{{# show }}Yes{{/ show }}", { show: true })).toBe("Yes")
		})
	})

	describe("エッジケース", () => {
		it("テンプレートなしの文字列をそのまま返す", () => {
			expect(render("No templates here", {})).toBe("No templates here")
		})

		it("空のテンプレートを空文字列で返す", () => {
			expect(render("", {})).toBe("")
		})

		it("閉じタグのない{{をテキストとして扱う", () => {
			expect(render("Hello {{ world", {})).toBe("Hello {{ world")
		})

		it("ネストしたセクションを処理する", () => {
			const data = { a: true, b: true }
			expect(render("{{#a}}{{#b}}OK{{/b}}{{/a}}", data)).toBe("OK")
		})
	})
})

describe("compile", () => {
	it("コンパイル済み関数を複数回使用できる", () => {
		const fn = compile("Hello {{name}}!")
		expect(fn({ name: "Alice" })).toBe("Hello Alice!")
		expect(fn({ name: "Bob" })).toBe("Hello Bob!")
	})

	it("同じテンプレートで異なるデータを処理する", () => {
		const fn = compile("{{greeting}} {{name}}")
		expect(fn({ greeting: "Hi", name: "A" })).toBe("Hi A")
		expect(fn({ greeting: "Hey", name: "B" })).toBe("Hey B")
	})
})

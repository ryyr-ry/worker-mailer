import { describe, expect, it } from "vitest"
import { htmlToText } from "../../src/html-to-text"

describe("htmlToText", () => {
	describe("基本変換", () => {
		it("プレーンテキストをそのまま返す", () => {
			expect(htmlToText("Hello World")).toBe("Hello World")
		})

		it("HTMLタグを除去する", () => {
			expect(htmlToText("<b>Bold</b> and <i>italic</i>")).toBe("Bold and italic")
		})

		it("空のHTMLを空文字列で返す", () => {
			expect(htmlToText("")).toBe("")
		})
	})

	describe("ブロック要素", () => {
		it("<br>を改行に変換する", () => {
			expect(htmlToText("Line 1<br>Line 2")).toBe("Line 1\nLine 2")
		})

		it("<br />を改行に変換する", () => {
			expect(htmlToText("Line 1<br />Line 2")).toBe("Line 1\nLine 2")
		})

		it("<p>を段落に変換する", () => {
			expect(htmlToText("<p>Para 1</p><p>Para 2</p>")).toBe("Para 1\n\nPara 2")
		})

		it("<div>を改行に変換する", () => {
			expect(htmlToText("<div>Block 1</div><div>Block 2</div>")).toBe("Block 1\nBlock 2")
		})

		it("<h1>-<h6>を見出しに変換する", () => {
			const result = htmlToText("<h1>Title</h1><p>Content</p>")
			expect(result).toBe("Title\n\nContent")
		})
	})

	describe("リンク変換", () => {
		it("リンクをテキスト (URL) 形式に変換する", () => {
			const result = htmlToText('<a href="https://example.com">Click here</a>')
			expect(result).toBe("Click here (https://example.com)")
		})

		it("リンクテキストがURLと同じ場合URLのみを出力する", () => {
			const result = htmlToText(
				'<a href="https://example.com">https://example.com</a>',
			)
			expect(result).toBe("https://example.com")
		})

		it("preserveLinks=falseでリンクURLを省略する", () => {
			const result = htmlToText('<a href="https://example.com">Click</a>', {
				preserveLinks: false,
			})
			expect(result).toBe("Click")
		})

		it("空のリンクテキストの場合URLを出力する", () => {
			const result = htmlToText('<a href="https://example.com"></a>')
			expect(result).toBe("https://example.com")
		})
	})

	describe("リスト変換", () => {
		it("順序なしリストをハイフン形式に変換する", () => {
			const result = htmlToText("<ul><li>Item 1</li><li>Item 2</li></ul>")
			expect(result).toContain("- Item 1")
			expect(result).toContain("- Item 2")
		})

		it("順序付きリストをハイフン形式に変換する", () => {
			const result = htmlToText("<ol><li>First</li><li>Second</li></ol>")
			expect(result).toContain("- First")
			expect(result).toContain("- Second")
		})
	})

	describe("水平線", () => {
		it("<hr>を---に変換する", () => {
			const result = htmlToText("Above<hr>Below")
			expect(result).toContain("---")
		})
	})

	describe("HTMLエンティティ", () => {
		it("基本エンティティをデコードする", () => {
			expect(htmlToText("&amp; &lt; &gt; &quot;")).toBe('& < > "')
		})

		it("&nbsp;をスペースに変換する", () => {
			expect(htmlToText("Hello&nbsp;World")).toBe("Hello World")
		})

		it("数値参照をデコードする", () => {
			expect(htmlToText("&#169;")).toBe("©")
		})

		it("16進数参照をデコードする", () => {
			expect(htmlToText("&#xA9;")).toBe("©")
		})

		it("特殊エンティティをデコードする", () => {
			expect(htmlToText("&mdash; &ndash; &hellip;")).toBe("— – …")
		})
	})

	describe("スタイル・スクリプト除去", () => {
		it("<style>タグを完全に除去する", () => {
			const result = htmlToText(
				"<style>body { color: red; }</style><p>Content</p>",
			)
			expect(result).toBe("Content")
		})

		it("<script>タグを完全に除去する", () => {
			const result = htmlToText(
				'<script>alert("xss")</script><p>Safe</p>',
			)
			expect(result).toBe("Safe")
		})
	})

	describe("コメント除去", () => {
		it("HTMLコメントを除去する", () => {
			const result = htmlToText("Before<!-- comment -->After")
			expect(result).toBe("BeforeAfter")
		})

		it("複数行コメントを除去する", () => {
			const result = htmlToText("Before<!--\nmultiline\ncomment\n-->After")
			expect(result).toBe("BeforeAfter")
		})
	})

	describe("空白正規化", () => {
		it("連続空白を1つに正規化する", () => {
			expect(htmlToText("Hello   World")).toBe("Hello World")
		})

		it("タブを空白に変換する", () => {
			expect(htmlToText("Hello\tWorld")).toBe("Hello World")
		})

		it("3つ以上の連続改行を2つに正規化する", () => {
			expect(htmlToText("A\n\n\n\nB")).toBe("A\n\nB")
		})

		it("前後の空白をトリムする", () => {
			expect(htmlToText("  Hello  ")).toBe("Hello")
		})
	})

	describe("行折り返し", () => {
		it("デフォルトで78文字で折り返す", () => {
			const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ")
			const result = htmlToText(words)
			const lines = result.split("\n")
			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(78)
			}
			expect(lines.length).toBeGreaterThan(1)
		})

		it("wordwrapオプションで折り返し幅を指定できる", () => {
			const text = "Hello World this is a test of word wrapping"
			const result = htmlToText(text, { wordwrap: 20 })
			const lines = result.split("\n")
			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(20)
			}
		})

		it("wordwrap=falseで折り返しを無効にする", () => {
			const long = "Word ".repeat(50)
			const result = htmlToText(long, { wordwrap: false })
			expect(result.split("\n")).toHaveLength(1)
		})

		it("単一の長い単語は折り返さない", () => {
			const word = "A".repeat(100)
			const result = htmlToText(word, { wordwrap: 50 })
			expect(result).toBe(word)
		})
	})

	describe("複合テスト", () => {
		it("典型的なHTMLメールを変換する", () => {
			const html = `
				<h1>Welcome!</h1>
				<p>Thank you for signing up.</p>
				<p>Click <a href="https://example.com/verify">here</a> to verify.</p>
				<ul>
					<li>Feature 1</li>
					<li>Feature 2</li>
				</ul>
				<p>&copy; 2024 Example Inc.</p>
			`
			const result = htmlToText(html)
			expect(result).toContain("Welcome!")
			expect(result).toContain("Thank you for signing up.")
			expect(result).toContain("here (https://example.com/verify)")
			expect(result).toContain("- Feature 1")
			expect(result).toContain("- Feature 2")
			expect(result).toContain("© 2024 Example Inc.")
		})

		it("テーブルを含むHTMLを処理する", () => {
			const html = "<table><tr><td>Cell 1</td><td>Cell 2</td></tr></table>"
			const result = htmlToText(html)
			expect(result).toBe("Cell 1 Cell 2")
		})

		it("ネストしたHTML構造を正しく変換する", () => {
			const html = "<div><p>Nested <b>bold</b> text</p></div>"
			const result = htmlToText(html)
			expect(result).toBe("Nested bold text")
		})
	})
})

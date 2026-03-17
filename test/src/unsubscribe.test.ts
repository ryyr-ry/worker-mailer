import { describe, expect, it } from "vitest"
import { unsubscribeHeaders } from "../../src/unsubscribe"

describe("unsubscribeHeaders", () => {
	describe("基本動作", () => {
		it("URLのみで配信停止ヘッダーを生成する", () => {
			const result = unsubscribeHeaders({ url: "https://example.com/unsub?id=123" })
			expect(result["List-Unsubscribe"]).toBe("<https://example.com/unsub?id=123>")
			expect(result["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
		})

		it("URL + mailtoで配信停止ヘッダーを生成する", () => {
			const result = unsubscribeHeaders({
				url: "https://example.com/unsub",
				mailto: "unsub@example.com",
			})
			expect(result["List-Unsubscribe"]).toBe(
				"<mailto:unsub@example.com>, <https://example.com/unsub>",
			)
			expect(result["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
		})

		it("返り値の型が正しい", () => {
			const result = unsubscribeHeaders({ url: "https://example.com/unsub" })
			expect(result).toHaveProperty("List-Unsubscribe")
			expect(result).toHaveProperty("List-Unsubscribe-Post")
			expect(Object.keys(result)).toHaveLength(2)
		})
	})

	describe("URL形式", () => {
		it("クエリパラメータ付きURLを受け入れる", () => {
			const result = unsubscribeHeaders({
				url: "https://example.com/unsub?user=abc&token=xyz",
			})
			expect(result["List-Unsubscribe"]).toBe(
				"<https://example.com/unsub?user=abc&token=xyz>",
			)
		})

		it("パスパラメータ付きURLを受け入れる", () => {
			const result = unsubscribeHeaders({
				url: "https://example.com/unsub/abc123",
			})
			expect(result["List-Unsubscribe"]).toBe("<https://example.com/unsub/abc123>")
		})
	})

	describe("バリデーション", () => {
		it("不正なURLでエラーを投げる", () => {
			expect(() => unsubscribeHeaders({ url: "not-a-url" })).toThrow("Invalid URL")
		})

		it("空のURLでエラーを投げる", () => {
			expect(() => unsubscribeHeaders({ url: "" })).toThrow("Invalid URL")
		})

		it("不正なmailtoアドレスでエラーを投げる", () => {
			expect(() =>
				unsubscribeHeaders({
					url: "https://example.com/unsub",
					mailto: "not-an-email",
				}),
			).toThrow("Invalid mailto address")
		})
	})

	describe("セキュリティ", () => {
		it("URLにCRLFが含まれる場合エラーを投げる", () => {
			expect(() =>
				unsubscribeHeaders({ url: "https://example.com\r\nevil" }),
			).toThrow("CRLF injection")
		})

		it("URLにLFが含まれる場合エラーを投げる", () => {
			expect(() => unsubscribeHeaders({ url: "https://example.com\nevil" })).toThrow(
				"CRLF injection",
			)
		})

		it("mailtoにCRLFが含まれる場合エラーを投げる", () => {
			expect(() =>
				unsubscribeHeaders({
					url: "https://example.com/unsub",
					mailto: "evil\r\n@example.com",
				}),
			).toThrow("CRLF injection")
		})
	})

	describe("RFC 8058準拠", () => {
		it("List-Unsubscribe-PostがOne-Click形式である", () => {
			const result = unsubscribeHeaders({ url: "https://example.com/unsub" })
			expect(result["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
		})

		it("mailtoがURLの前に配置される", () => {
			const result = unsubscribeHeaders({
				url: "https://example.com/unsub",
				mailto: "unsub@example.com",
			})
			const parts = result["List-Unsubscribe"].split(", ")
			expect(parts[0]).toContain("mailto:")
			expect(parts[1]).toContain("https://")
		})
	})
})

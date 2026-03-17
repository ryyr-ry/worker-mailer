import { describe, expect, it } from "vitest"
import { threadHeaders } from "../../src/thread"

describe("threadHeaders", () => {
	describe("基本動作", () => {
		it("単一メッセージへの返信ヘッダーを生成する", () => {
			const result = threadHeaders({ inReplyTo: "<abc@example.com>" })
			expect(result["In-Reply-To"]).toBe("<abc@example.com>")
			expect(result.References).toBe("<abc@example.com>")
		})

		it("既存Referencesチェーンにメッセージを追加する", () => {
			const result = threadHeaders({
				inReplyTo: "<msg3@example.com>",
				references: "<msg1@example.com> <msg2@example.com>",
			})
			expect(result["In-Reply-To"]).toBe("<msg3@example.com>")
			expect(result.References).toBe(
				"<msg1@example.com> <msg2@example.com> <msg3@example.com>",
			)
		})

		it("単一ReferenceのあるメッセージIDを追加する", () => {
			const result = threadHeaders({
				inReplyTo: "<reply@example.com>",
				references: "<original@example.com>",
			})
			expect(result["In-Reply-To"]).toBe("<reply@example.com>")
			expect(result.References).toBe("<original@example.com> <reply@example.com>")
		})
	})

	describe("空白処理", () => {
		it("inReplyToの前後空白をトリムする", () => {
			const result = threadHeaders({ inReplyTo: "  <abc@example.com>  " })
			expect(result["In-Reply-To"]).toBe("<abc@example.com>")
			expect(result.References).toBe("<abc@example.com>")
		})

		it("referencesの前後空白をトリムする", () => {
			const result = threadHeaders({
				inReplyTo: "<b@example.com>",
				references: "  <a@example.com>  ",
			})
			expect(result.References).toBe("<a@example.com> <b@example.com>")
		})
	})

	describe("バリデーション", () => {
		it("不正なMessage-ID形式でエラーを投げる", () => {
			expect(() => threadHeaders({ inReplyTo: "no-angle-brackets" })).toThrow(
				"Invalid Message-ID format",
			)
		})

		it("空のMessage-IDでエラーを投げる", () => {
			expect(() => threadHeaders({ inReplyTo: "" })).toThrow("Invalid Message-ID format")
		})

		it("角括弧がないMessage-IDでエラーを投げる", () => {
			expect(() => threadHeaders({ inReplyTo: "abc@example.com" })).toThrow(
				"Invalid Message-ID format",
			)
		})

		it("開き角括弧だけのMessage-IDでエラーを投げる", () => {
			expect(() => threadHeaders({ inReplyTo: "<abc@example.com" })).toThrow(
				"Invalid Message-ID format",
			)
		})

		it("不正なReferencesでエラーを投げる", () => {
			expect(() =>
				threadHeaders({
					inReplyTo: "<valid@example.com>",
					references: "invalid-ref",
				}),
			).toThrow("Invalid Message-ID in References")
		})

		it("References内に不正なIDが混在する場合エラーを投げる", () => {
			expect(() =>
				threadHeaders({
					inReplyTo: "<valid@example.com>",
					references: "<ok@example.com> broken",
				}),
			).toThrow("Invalid Message-ID in References")
		})

		it("CRLFを含むMessage-IDを拒否する", () => {
			expect(() => threadHeaders({ inReplyTo: "<abc\r\nBcc: evil@x.com>" })).toThrow(
				"Invalid Message-ID format",
			)
		})

		it("LFを含むMessage-IDを拒否する", () => {
			expect(() => threadHeaders({ inReplyTo: "<abc\nevil@x.com>" })).toThrow(
				"Invalid Message-ID format",
			)
		})

		it("CRLFを含むReferencesを拒否する", () => {
			expect(() =>
				threadHeaders({
					inReplyTo: "<valid@example.com>",
					references: "<ok@example.com>\r\n<evil@x.com>",
				}),
			).toThrow("References must not contain CRLF")
		})
	})

	describe("RFC 5322準拠", () => {
		it("複雑なMessage-IDを正しく処理する", () => {
			const complexId = "<1234567890.123456@mail.gmail.com>"
			const result = threadHeaders({ inReplyTo: complexId })
			expect(result["In-Reply-To"]).toBe(complexId)
		})

		it("長いスレッドチェーンを正しく構築する", () => {
			const refs = "<a@x.com> <b@x.com> <c@x.com> <d@x.com> <e@x.com>"
			const result = threadHeaders({
				inReplyTo: "<f@x.com>",
				references: refs,
			})
			expect(result.References).toBe(`${refs} <f@x.com>`)
		})

		it("返り値の型が正しい", () => {
			const result = threadHeaders({ inReplyTo: "<test@example.com>" })
			expect(result).toHaveProperty("In-Reply-To")
			expect(result).toHaveProperty("References")
			expect(Object.keys(result)).toHaveLength(2)
		})
	})
})

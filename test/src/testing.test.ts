import { describe, expect, it } from "vitest"
import { createTestEmail } from "../../src/testing"

describe("createTestEmail", () => {
	it("必須フィールドのみで有効なEmailOptionsを返す", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
		})

		expect(result.from).toBe("sender@example.com")
		expect(result.to).toBe("recipient@example.com")
		expect(result.subject).toMatch(/^\[worker-mailer\] 送信テスト —/)
		expect(result.text).toContain("✅ worker-mailer: 送信テスト成功")
		expect(result.text).toContain("sender@example.com")
		expect(result.html).toContain("送信テスト成功")
		expect(result.html).toContain("sender@example.com")
	})

	it("smtpHost指定時にSMTP情報が含まれる", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			smtpHost: "smtp.gmail.com",
		})

		expect(result.text).toContain("SMTP: smtp.gmail.com")
		expect(result.html).toContain("smtp.gmail.com")
	})

	it("smtpHost未指定時にSMTP情報が含まれない", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
		})

		expect(result.text).not.toContain("SMTP:")
		expect(result.html).not.toContain("<p>SMTP:")
	})

	it("複数宛先を受け付ける", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: ["a@example.com", "b@example.com"],
		})

		expect(result.to).toEqual(["a@example.com", "b@example.com"])
	})

	it("HTMLにXSSエスケープが適用される", () => {
		const result = createTestEmail({
			from: '<script>alert("xss")</script>@example.com',
			to: "recipient@example.com",
			smtpHost: '<img onerror="alert(1)">',
		})

		expect(result.html).not.toContain("<script>")
		expect(result.html).not.toContain('onerror="')
		expect(result.html).toContain("&lt;script&gt;")
		expect(result.html).toContain("&lt;img onerror=")
	})

	it("タイムスタンプがISO 8601形式", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
		})

		const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
		expect(result.subject).toMatch(isoPattern)
		expect(result.text).toMatch(isoPattern)
		expect(result.html).toMatch(isoPattern)
	})

	it("生成されたHTMLが有効な構造を持つ", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
		})

		expect(result.html).toContain("<!DOCTYPE html>")
		expect(result.html).toContain('<meta charset="utf-8">')
		expect(result.html).toContain("</html>")
	})
})

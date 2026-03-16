import { describe, expect, it } from "vitest"
import { Email } from "../../src/email/email"
import { createTestEmail } from "../../src/testing"

describe("createTestEmail", () => {
	it("should return valid EmailOptions with only required fields", () => {
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

	it("should include SMTP info when smtpHost is specified", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			smtpHost: "smtp.gmail.com",
		})

		expect(result.text).toContain("SMTP: smtp.gmail.com")
		expect(result.html).toContain("smtp.gmail.com")
	})

	it("should not include SMTP info when smtpHost is not specified", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
		})

		expect(result.text).not.toContain("SMTP:")
		expect(result.html).not.toContain("<p>SMTP:")
	})

	it("should accept multiple recipients", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: ["a@example.com", "b@example.com"],
		})

		expect(result.to).toEqual(["a@example.com", "b@example.com"])
	})

	it("should apply XSS escaping in HTML", () => {
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

	it("should format timestamps in ISO 8601", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
		})

		const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
		expect(result.subject).toMatch(isoPattern)
		expect(result.text).toMatch(isoPattern)
		expect(result.html).toMatch(isoPattern)
	})

	it("returns EmailOptions with string fields", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
		})
		expect(typeof result.from).toBe("string")
		expect(typeof result.subject).toBe("string")
		expect(typeof result.text).toBe("string")
		expect(typeof result.html).toBe("string")
	})

	it("empty from produces invalid Email on construction", () => {
		const opts = createTestEmail({
			from: "",
			to: "recipient@example.com",
		})
		expect(() => new Email(opts)).toThrow()
	})

	it("empty to results in Email with empty recipient list", () => {
		const opts = createTestEmail({
			from: "sender@example.com",
			to: "",
		})
		const email = new Email(opts)
		expect(email.to).toEqual([])
	})

	it("should have valid HTML structure in generated output", () => {
		const result = createTestEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
		})

		expect(result.html).toContain("<!DOCTYPE html>")
		expect(result.html).toContain('<meta charset="utf-8">')
		expect(result.html).toContain("</html>")
	})
})

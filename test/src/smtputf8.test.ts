import { describe, expect, it } from "vitest"
import { parseCapabilities } from "../../src/mailer/handshake"
import { hasNonAscii } from "../../src/mailer/commands"

describe("SMTPUTF8", () => {
	describe("parseCapabilities", () => {
		it("SMTPUTF8能力を検出する", () => {
			const response = "250-mail.example.com\r\n250-SIZE 52428800\r\n250-SMTPUTF8\r\n250 OK"
			const caps = parseCapabilities(response)
			expect(caps.supportsSmtpUtf8).toBe(true)
		})

		it("SMTPUTF8がない場合falseを返す", () => {
			const response = "250-mail.example.com\r\n250-SIZE 52428800\r\n250 OK"
			const caps = parseCapabilities(response)
			expect(caps.supportsSmtpUtf8).toBe(false)
		})

		it("SMTPUTF8を大文字小文字を区別せず検出する", () => {
			const response = "250-mail.example.com\r\n250-smtputf8\r\n250 OK"
			const caps = parseCapabilities(response)
			expect(caps.supportsSmtpUtf8).toBe(true)
		})

		it("他の能力と共にSMTPUTF8を検出する", () => {
			const response =
				"250-mail.example.com\r\n250-AUTH PLAIN LOGIN\r\n250-STARTTLS\r\n250-DSN\r\n250-SMTPUTF8\r\n250 OK"
			const caps = parseCapabilities(response)
			expect(caps.supportsSmtpUtf8).toBe(true)
			expect(caps.supportsStartTls).toBe(true)
			expect(caps.supportsDSN).toBe(true)
			expect(caps.allowAuth).toBe(true)
		})
	})

	describe("hasNonAscii", () => {
		it("ASCII文字列でfalseを返す", () => {
			expect(hasNonAscii("user@example.com")).toBe(false)
		})

		it("日本語ドメインでtrueを返す", () => {
			expect(hasNonAscii("user@メール.jp")).toBe(true)
		})

		it("日本語ローカルパートでtrueを返す", () => {
			expect(hasNonAscii("田中@example.com")).toBe(true)
		})

		it("ウムラウトでtrueを返す", () => {
			expect(hasNonAscii("müller@example.de")).toBe(true)
		})

		it("空文字列でfalseを返す", () => {
			expect(hasNonAscii("")).toBe(false)
		})

		it("ASCII記号のみでfalseを返す", () => {
			expect(hasNonAscii("user+tag@sub.example.com")).toBe(false)
		})

		it("絵文字でtrueを返す", () => {
			expect(hasNonAscii("😀@example.com")).toBe(true)
		})
	})
})

import { describe, expect, it } from "vitest"
import { parseCapabilities } from "../../src/mailer/handshake"
import { hasNonAscii, mailFrom } from "../../src/mailer/commands"
import { SmtpCommandError } from "../../src/errors"
import type { SmtpTransport } from "../../src/mailer/transport"
import type { SmtpCapabilities } from "../../src/mailer/types"

function createMockTransport(): { transport: SmtpTransport; commands: string[] } {
	const commands: string[] = []
	const transport = {
		writeLine: async (msg: string) => { commands.push(msg) },
		readTimeout: async () => "250 OK",
	} as unknown as SmtpTransport
	return { transport, commands }
}

function createCapabilities(overrides?: Partial<SmtpCapabilities>): SmtpCapabilities {
	return {
		supportsDSN: false,
		allowAuth: false,
		authTypeSupported: [],
		supportsStartTls: false,
		supportsSmtpUtf8: false,
		...overrides,
	}
}

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

		it("XSMTPUTFのような類似拡張に誤マッチしない", () => {
			const response = "250-mail.example.com\r\n250-XSMTPUTF8\r\n250 OK"
			const caps = parseCapabilities(response)
			expect(caps.supportsSmtpUtf8).toBe(false)
		})

		it("SMTPUTF8_EXTENDEDのような類似拡張に誤マッチしない", () => {
			const response = "250-mail.example.com\r\n250-SMTPUTF8_EXTENDED\r\n250 OK"
			const caps = parseCapabilities(response)
			expect(caps.supportsSmtpUtf8).toBe(false)
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

	describe("mailFromのSMTPUTF8統合", () => {
		it("SMTPUTF8対応サーバーでSMTPUTF8パラメータを付与する", async () => {
			const { transport, commands } = createMockTransport()
			const caps = createCapabilities({ supportsSmtpUtf8: true })

			await mailFrom({
				transport,
				fromEmail: "田中@example.com",
				capabilities: caps,
				smtpUtf8: true,
			})

			expect(commands[0]).toBe("MAIL FROM: <田中@example.com> SMTPUTF8")
		})

		it("SMTPUTF8非対応サーバーではパラメータを付与しない", async () => {
			const { transport, commands } = createMockTransport()
			const caps = createCapabilities({ supportsSmtpUtf8: false })

			await mailFrom({
				transport,
				fromEmail: "田中@example.com",
				capabilities: caps,
				smtpUtf8: true,
			})

			expect(commands[0]).toBe("MAIL FROM: <田中@example.com>")
		})

		it("smtpUtf8フラグがfalseの場合パラメータを付与しない", async () => {
			const { transport, commands } = createMockTransport()
			const caps = createCapabilities({ supportsSmtpUtf8: true })

			await mailFrom({
				transport,
				fromEmail: "user@example.com",
				capabilities: caps,
				smtpUtf8: false,
			})

			expect(commands[0]).toBe("MAIL FROM: <user@example.com>")
		})

		it("サーバーがMAIL FROMを拒否した場合SmtpCommandErrorを投げる", async () => {
			const transport = {
				writeLine: async () => {},
				readTimeout: async () => "550 User not found",
			} as unknown as SmtpTransport
			const caps = createCapabilities({ supportsSmtpUtf8: true })

			await expect(
				mailFrom({
					transport,
					fromEmail: "田中@example.com",
					capabilities: caps,
					smtpUtf8: true,
				}),
			).rejects.toThrow(SmtpCommandError)
		})
	})
})

import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import {
	createFromEnv,
	fromEnv,
	gmailPreset,
	outlookPreset,
	sendgridPreset,
	sendOnce,
} from "../../src/convenience"

vi.mock("cloudflare:sockets", () => ({
	connect: vi.fn(),
}))

describe("convenience", () => {
	describe("fromEnv", () => {
		it("必須変数のみでオプションを生成できる", () => {
			const env = {
				SMTP_HOST: "smtp.example.com",
				SMTP_PORT: "587",
			}
			const options = fromEnv(env)
			expect(options.host).toBe("smtp.example.com")
			expect(options.port).toBe(587)
			expect(options.credentials).toBeUndefined()
			expect(options.secure).toBeUndefined()
		})

		it("全変数を指定して正しくオプションを生成できる", () => {
			const env = {
				SMTP_HOST: "smtp.example.com",
				SMTP_PORT: "465",
				SMTP_USER: "user@example.com",
				SMTP_PASS: "secret",
				SMTP_SECURE: "true",
				SMTP_START_TLS: "false",
				SMTP_AUTH_TYPE: "plain,login",
				SMTP_EHLO_HOSTNAME: "my-worker.example.com",
				SMTP_LOG_LEVEL: "DEBUG",
				SMTP_MAX_RETRIES: "5",
			}
			const options = fromEnv(env)
			expect(options.host).toBe("smtp.example.com")
			expect(options.port).toBe(465)
			expect(options.credentials).toEqual({
				username: "user@example.com",
				password: "secret",
			})
			expect(options.secure).toBe(true)
			expect(options.startTls).toBe(false)
			expect(options.authType).toEqual(["plain", "login"])
			expect(options.ehloHostname).toBe("my-worker.example.com")
			expect(options.maxRetries).toBe(5)
		})

		it("SMTP_HOST が未設定の場合エラーをスローする", () => {
			const env = { SMTP_PORT: "587" }
			expect(() => fromEnv(env)).toThrow("SMTP_HOST")
		})

		it("SMTP_PORT が未設定の場合エラーをスローする", () => {
			const env = { SMTP_HOST: "smtp.example.com" }
			expect(() => fromEnv(env)).toThrow("SMTP_PORT")
		})

		it("SMTP_PORT が数値でない場合エラーをスローする", () => {
			const env = { SMTP_HOST: "smtp.example.com", SMTP_PORT: "abc" }
			expect(() => fromEnv(env)).toThrow("有効なポート番号")
		})

		it("SMTP_SECURE の各値を正しくパースする", () => {
			for (const val of ["true", "1", "yes"]) {
				const options = fromEnv({
					SMTP_HOST: "h",
					SMTP_PORT: "25",
					SMTP_SECURE: val,
				})
				expect(options.secure).toBe(true)
			}
			for (const val of ["false", "0", "no"]) {
				const options = fromEnv({
					SMTP_HOST: "h",
					SMTP_PORT: "25",
					SMTP_SECURE: val,
				})
				expect(options.secure).toBe(false)
			}
		})

		it("SMTP_AUTH_TYPE から無効な値をフィルタする", () => {
			const env = {
				SMTP_HOST: "h",
				SMTP_PORT: "25",
				SMTP_AUTH_TYPE: "plain,invalid,login,cram-md5",
			}
			const options = fromEnv(env)
			expect(options.authType).toEqual(["plain", "login", "cram-md5"])
		})

		it("SMTP_LOG_LEVEL を正しくパースする", () => {
			const env = { SMTP_HOST: "h", SMTP_PORT: "25", SMTP_LOG_LEVEL: "error" }
			const options = fromEnv(env)
			expect(options.logLevel).toBeDefined()
		})

		it("credentials はユーザーとパスワード両方ある場合のみ設定される", () => {
			const envUserOnly = {
				SMTP_HOST: "h",
				SMTP_PORT: "25",
				SMTP_USER: "user",
			}
			expect(fromEnv(envUserOnly).credentials).toBeUndefined()

			const envBoth = {
				SMTP_HOST: "h",
				SMTP_PORT: "25",
				SMTP_USER: "user",
				SMTP_PASS: "pass",
			}
			expect(fromEnv(envBoth).credentials).toEqual({
				username: "user",
				password: "pass",
			})
		})
	})

	describe("プリセット関数", () => {
		const env = {
			SMTP_USER: "user@gmail.com",
			SMTP_PASS: "app-password",
		}

		it("gmailPreset が正しい設定を返す", () => {
			const options = gmailPreset(env)
			expect(options.host).toBe("smtp.gmail.com")
			expect(options.port).toBe(587)
			expect(options.secure).toBe(false)
			expect(options.startTls).toBe(true)
			expect(options.authType).toEqual(["plain"])
			expect(options.credentials).toEqual({
				username: "user@gmail.com",
				password: "app-password",
			})
		})

		it("outlookPreset が正しい設定を返す", () => {
			const options = outlookPreset(env)
			expect(options.host).toBe("smtp.office365.com")
			expect(options.port).toBe(587)
			expect(options.secure).toBe(false)
			expect(options.startTls).toBe(true)
			expect(options.credentials).toEqual({
				username: "user@gmail.com",
				password: "app-password",
			})
		})

		it("sendgridPreset が正しい設定を返す", () => {
			const options = sendgridPreset(env)
			expect(options.host).toBe("smtp.sendgrid.net")
			expect(options.port).toBe(587)
			expect(options.secure).toBe(false)
			expect(options.startTls).toBe(true)
			expect(options.credentials).toEqual({
				username: "user@gmail.com",
				password: "app-password",
			})
		})

		it("credentials 未設定時は undefined を返す", () => {
			const options = gmailPreset({})
			expect(options.credentials).toBeUndefined()
		})

		it("SMTP_USER のみ設定時は credentials が undefined を返す", () => {
			expect(gmailPreset({ SMTP_USER: "user" }).credentials).toBeUndefined()
			expect(outlookPreset({ SMTP_PASS: "pass" }).credentials).toBeUndefined()
		})
	})

	describe("createFromEnv / sendOnce", () => {
		let mockReader: { read: Mock; releaseLock: Mock }
		let mockWriter: { write: Mock; releaseLock: Mock }

		beforeEach(() => {
			vi.clearAllMocks()

			mockReader = { read: vi.fn(), releaseLock: vi.fn() }
			mockWriter = { write: vi.fn(), releaseLock: vi.fn() }

			const mockSocket = {
				readable: { getReader: () => mockReader },
				writable: { getWriter: () => mockWriter },
				opened: Promise.resolve(),
				close: vi.fn().mockResolvedValue(undefined),
				startTls: vi.fn().mockReturnValue({
					readable: { getReader: () => mockReader },
					writable: { getWriter: () => mockWriter },
				}),
			}

			vi.mocked(connect).mockReturnValue(mockSocket as unknown as ReturnType<typeof connect>)
		})

		it("createFromEnv で WorkerMailer インスタンスを取得できる", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250-ok\r\n250-AUTH PLAIN LOGIN\r\n250 STARTTLS\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 TLS ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250-ok\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Auth OK\r\n"),
				})

			const env = {
				SMTP_HOST: "smtp.example.com",
				SMTP_PORT: "587",
				SMTP_USER: "user",
				SMTP_PASS: "pass",
				SMTP_AUTH_TYPE: "plain",
			}

			const mailer = await createFromEnv(env)
			expect(mailer).toBeDefined()
			expect(connect).toHaveBeenCalled()
		})

		it("sendOnce で接続→送信→切断を実行できる", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250-ok\r\n250-AUTH PLAIN LOGIN\r\n250 STARTTLS\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 TLS ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250-ok\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Auth OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 MAIL OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 RCPT OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const env = {
				SMTP_HOST: "smtp.example.com",
				SMTP_PORT: "587",
				SMTP_USER: "user",
				SMTP_PASS: "pass",
				SMTP_AUTH_TYPE: "plain",
			}

			const result = await sendOnce(env, {
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test",
				text: "Hello",
			})

			expect(connect).toHaveBeenCalled()
			expect(result).toBeDefined()
			expect(result.accepted).toEqual(["recipient@example.com"])
			expect(result.rejected).toEqual([])
			expect(typeof result.messageId).toBe("string")
			expect(typeof result.responseTime).toBe("number")
			expect(typeof result.response).toBe("string")
		})
	})

	describe("fromEnv prefix カスタマイズ", () => {
		it("カスタムプレフィックスで環境変数を読み取れる", () => {
			const env = {
				MAIL_HOST: "smtp.custom.com",
				MAIL_PORT: "465",
				MAIL_USER: "custom-user",
				MAIL_PASS: "custom-pass",
				MAIL_SECURE: "true",
			}
			const options = fromEnv(env, "MAIL_")
			expect(options.host).toBe("smtp.custom.com")
			expect(options.port).toBe(465)
			expect(options.credentials).toEqual({
				username: "custom-user",
				password: "custom-pass",
			})
			expect(options.secure).toBe(true)
		})

		it("デフォルトプレフィックスは SMTP_ のまま動作する", () => {
			const env = {
				SMTP_HOST: "smtp.example.com",
				SMTP_PORT: "587",
			}
			const options = fromEnv(env)
			expect(options.host).toBe("smtp.example.com")
			expect(options.port).toBe(587)
		})

		it("カスタムプレフィックスで必須変数未設定時にエラーをスローする", () => {
			const env = { MAIL_HOST: "smtp.custom.com" }
			expect(() => fromEnv(env, "MAIL_")).toThrow("MAIL_PORT")
		})
	})

	describe("createFromEnv / sendOnce with prefix", () => {
		let mockReader: { read: Mock; releaseLock: Mock }
		let mockWriter: { write: Mock; releaseLock: Mock }

		beforeEach(() => {
			vi.clearAllMocks()

			mockReader = { read: vi.fn(), releaseLock: vi.fn() }
			mockWriter = { write: vi.fn(), releaseLock: vi.fn() }

			const mockSocket = {
				readable: { getReader: () => mockReader },
				writable: { getWriter: () => mockWriter },
				opened: Promise.resolve(),
				close: vi.fn().mockResolvedValue(undefined),
				startTls: vi.fn().mockReturnValue({
					readable: { getReader: () => mockReader },
					writable: { getWriter: () => mockWriter },
				}),
			}

			vi.mocked(connect).mockReturnValue(mockSocket as unknown as ReturnType<typeof connect>)
		})

		it("createFromEnv にカスタムプレフィックスを渡せる", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250-ok\r\n250-AUTH PLAIN LOGIN\r\n250 STARTTLS\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 TLS ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250-ok\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Auth OK\r\n"),
				})

			const env = {
				MAIL_HOST: "smtp.example.com",
				MAIL_PORT: "587",
				MAIL_USER: "user",
				MAIL_PASS: "pass",
				MAIL_AUTH_TYPE: "plain",
			}

			const mailer = await createFromEnv(env, "MAIL_")
			expect(mailer).toBeDefined()
			expect(connect).toHaveBeenCalled()
		})

		it("sendOnce にカスタムプレフィックスを渡せる", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250-ok\r\n250-AUTH PLAIN LOGIN\r\n250 STARTTLS\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 TLS ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250-ok\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Auth OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 MAIL OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 RCPT OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const env = {
				MAIL_HOST: "smtp.example.com",
				MAIL_PORT: "587",
				MAIL_USER: "user",
				MAIL_PASS: "pass",
				MAIL_AUTH_TYPE: "plain",
			}

			const result = await sendOnce(
				env,
				{
					from: "sender@example.com",
					to: "recipient@example.com",
					subject: "Test",
					text: "Hello",
				},
				"MAIL_",
			)
			expect(result).toBeDefined()
			expect(connect).toHaveBeenCalled()
		})
	})
})

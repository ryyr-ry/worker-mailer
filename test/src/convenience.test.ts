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
		it("should generate options with only required variables", () => {
			const env = {
				SMTP_HOST: "smtp.example.com",
				SMTP_PORT: "587",
			}
			const options = fromEnv(env)
			expect(options.host).toBe("smtp.example.com")
			expect(options.port).toBe(587)
			expect(options.username).toBeUndefined()
			expect(options.secure).toBeUndefined()
		})

		it("should generate correct options with all variables specified", () => {
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
			expect(options.username).toBe("user@example.com")
			expect(options.password).toBe("secret")
			expect(options.secure).toBe(true)
			expect(options.startTls).toBe(false)
			expect(options.authType).toEqual(["plain", "login"])
			expect(options.ehloHostname).toBe("my-worker.example.com")
			expect(options.maxRetries).toBe(5)
		})

		it("should throw error when SMTP_HOST is not set", () => {
			const env = { SMTP_PORT: "587" }
			expect(() => fromEnv(env)).toThrow("SMTP_HOST")
		})

		it("should throw error when SMTP_PORT is not set", () => {
			const env = { SMTP_HOST: "smtp.example.com" }
			expect(() => fromEnv(env)).toThrow("SMTP_PORT")
		})

		it("should throw error when SMTP_PORT is not a number", () => {
			const env = { SMTP_HOST: "smtp.example.com", SMTP_PORT: "abc" }
			expect(() => fromEnv(env)).toThrow("not a valid port number")
		})

		it("should parse SMTP_SECURE values correctly", () => {
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

		it("should filter out invalid values from SMTP_AUTH_TYPE", () => {
			const env = {
				SMTP_HOST: "h",
				SMTP_PORT: "25",
				SMTP_AUTH_TYPE: "plain,invalid,login,cram-md5",
			}
			const options = fromEnv(env)
			expect(options.authType).toEqual(["plain", "login", "cram-md5"])
		})

		it("should parse SMTP_LOG_LEVEL correctly", () => {
			const env = { SMTP_HOST: "h", SMTP_PORT: "25", SMTP_LOG_LEVEL: "error" }
			const options = fromEnv(env)
			expect(options.logLevel).toBeDefined()
		})

		it("should only set credentials when both user and password are provided", () => {
			const envUserOnly = {
				SMTP_HOST: "h",
				SMTP_PORT: "25",
				SMTP_USER: "user",
			}
			expect(fromEnv(envUserOnly).username).toBeUndefined()

			const envBoth = {
				SMTP_HOST: "h",
				SMTP_PORT: "25",
				SMTP_USER: "user",
				SMTP_PASS: "pass",
			}
			expect(fromEnv(envBoth).username).toBe("user")
			expect(fromEnv(envBoth).password).toBe("pass")
		})
	})

	describe("preset functions", () => {
		const env = {
			SMTP_USER: "user@gmail.com",
			SMTP_PASS: "app-password",
		}

		it("should return correct settings for gmailPreset", () => {
			const options = gmailPreset(env)
			expect(options.host).toBe("smtp.gmail.com")
			expect(options.port).toBe(587)
			expect(options.secure).toBe(false)
			expect(options.startTls).toBe(true)
			expect(options.authType).toEqual(["plain"])
			expect(options.username).toBe("user@gmail.com")
			expect(options.password).toBe("app-password")
		})

		it("should return correct settings for outlookPreset", () => {
			const options = outlookPreset(env)
			expect(options.host).toBe("smtp.office365.com")
			expect(options.port).toBe(587)
			expect(options.secure).toBe(false)
			expect(options.startTls).toBe(true)
			expect(options.username).toBe("user@gmail.com")
			expect(options.password).toBe("app-password")
		})

		it("should return correct settings for sendgridPreset", () => {
			const options = sendgridPreset(env)
			expect(options.host).toBe("smtp.sendgrid.net")
			expect(options.port).toBe(587)
			expect(options.secure).toBe(false)
			expect(options.startTls).toBe(true)
			expect(options.username).toBe("user@gmail.com")
			expect(options.password).toBe("app-password")
		})

		it("should return undefined when credentials are not set", () => {
			const options = gmailPreset({})
			expect(options.username).toBeUndefined()
		})

		it("SMTP_USER only: username set but no password", () => {
			expect(gmailPreset({ SMTP_USER: "user" }).username).toBeUndefined()
			expect(outlookPreset({ SMTP_PASS: "pass" }).username).toBeUndefined()
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

		it("should obtain a WorkerMailer instance via createFromEnv", async () => {
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

		it("should perform connect, send, and disconnect via sendOnce", async () => {
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

	describe("fromEnv prefix customization", () => {
		it("should read environment variables with a custom prefix", () => {
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
			expect(options.username).toBe("custom-user")
			expect(options.password).toBe("custom-pass")
			expect(options.secure).toBe(true)
		})

		it("should work with default SMTP_ prefix", () => {
			const env = {
				SMTP_HOST: "smtp.example.com",
				SMTP_PORT: "587",
			}
			const options = fromEnv(env)
			expect(options.host).toBe("smtp.example.com")
			expect(options.port).toBe(587)
		})

		it("should throw error when required variable is missing with custom prefix", () => {
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

		it("should accept a custom prefix in createFromEnv", async () => {
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

		it("should accept a custom prefix in sendOnce", async () => {
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

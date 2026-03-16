import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import {
	ConfigurationError,
	CrlfInjectionError,
	EmailValidationError,
	SmtpAuthError,
	SmtpCommandError,
	SmtpConnectionError,
} from "../../src/errors"
import { WorkerMailer, WorkerMailerPool } from "../../src/mailer"

vi.mock("cloudflare:sockets", () => ({
	connect: vi.fn(),
}))

describe("WorkerMailer", () => {
	interface MockReader {
		read: Mock
		releaseLock: Mock
	}
	interface MockWriter {
		write: Mock
		releaseLock: Mock
	}
	interface MockSocket {
		readable: { getReader: () => MockReader }
		writable: { getWriter: () => MockWriter }
		opened: Promise<void>
		close: Mock
		startTls: Mock
	}

	let mockSocket: MockSocket
	let mockReader: MockReader
	let mockWriter: MockWriter

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Setup mock socket and reader/writer
		mockReader = {
			read: vi.fn(),
			releaseLock: vi.fn(),
		}
		mockWriter = {
			write: vi.fn(),
			releaseLock: vi.fn(),
		}
		mockSocket = {
			readable: { getReader: () => mockReader },
			writable: { getWriter: () => mockWriter },
			opened: Promise.resolve(),
			close: vi.fn(),
			startTls: vi.fn().mockReturnValue({
				readable: { getReader: () => mockReader },
				writable: { getWriter: () => mockWriter },
			}),
		}

		// Setup connect mock
		vi.mocked(connect).mockReturnValue(mockSocket as unknown as ReturnType<typeof connect>)
	})

	describe("connection", () => {
		it("should connect to SMTP server successfully", async () => {
			// Mock successful connection sequence
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain", "login"],
			})

			expect(connect).toHaveBeenCalledWith(
				{
					hostname: "smtp.example.com",
					port: 587,
				},
				expect.any(Object),
			)
			expect(mailer).toBeInstanceOf(WorkerMailer)
		})

		it("should connect to SMTP server successfully with STARTTLS", async () => {
			// Mock successful connection sequence with STARTTLS
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 Ready to start TLS\r\n"),
				})
				// After STARTTLS, server expects another EHLO
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain", "login"],
			})

			expect(connect).toHaveBeenCalledWith(
				{
					hostname: "smtp.example.com",
					port: 587,
				},
				{
					secureTransport: "starttls",
					allowHalfOpen: false,
				},
			)
			expect(mailer).toBeInstanceOf(WorkerMailer)
		})

		it("should connect to SMTP server successfully without STARTTLS when secure", async () => {
			// Mock successful connection sequence without STARTTLS
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 465,
				secure: true,
				username: "test@example.com",
				password: "password",
				authType: ["plain", "login"],
			})

			expect(connect).toHaveBeenCalledWith(
				{
					hostname: "smtp.example.com",
					port: 465,
				},
				{
					secureTransport: "on",
					allowHalfOpen: false,
				},
			)
			expect(mailer).toBeInstanceOf(WorkerMailer)
		})

		it("should throw error on connection timeout", async () => {
			mockSocket.opened = new Promise(() => {}) // Never resolves

			await expect(
				WorkerMailer.connect({
					host: "smtp.example.com",
					port: 587,
					socketTimeoutMs: 100,
				}),
			).rejects.toThrow(SmtpConnectionError)
		})

		it("should use responseTimeoutMs independently from socketTimeoutMs", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain", "login"],
				socketTimeoutMs: 120_000,
				responseTimeoutMs: 15_000,
			})

			expect((mailer as unknown as { socketTimeoutMs: number }).socketTimeoutMs).toBe(120_000)
			expect((mailer as unknown as { responseTimeoutMs: number }).responseTimeoutMs).toBe(15_000)
			await mailer.close()
		})

		it("should use custom ehloHostname in EHLO command", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain", "login"],
				ehloHostname: "mail.atchecks.com",
			})

			const ehloCall = mockWriter.write.mock.calls.find(([arg]: [Uint8Array]) => {
				const str = Buffer.from(arg).toString()
				return str.startsWith("EHLO")
			})
			expect(ehloCall).toBeDefined()
			const ehloStr = Buffer.from((ehloCall as [Uint8Array])[0]).toString()
			expect(ehloStr).toContain("EHLO mail.atchecks.com")

			await mailer.close()
		})

		it("should default ehloHostname to host option", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain", "login"],
			})

			const ehloCall = mockWriter.write.mock.calls.find(([arg]: [Uint8Array]) => {
				const str = Buffer.from(arg).toString()
				return str.startsWith("EHLO")
			})
			expect(ehloCall).toBeDefined()
			const ehloStr = Buffer.from((ehloCall as [Uint8Array])[0]).toString()
			expect(ehloStr).toContain("EHLO smtp.example.com")

			await mailer.close()
		})
	})

	describe("server capabilities", () => {
		it("should parse server capabilities correctly", async () => {
			// Mock server response with various capabilities
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN CRAM-MD5\r\n250 HELP\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 Ready to start TLS\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 HELP\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain"],
			})

			expect(mailer).toBeInstanceOf(WorkerMailer)
			// Verify that STARTTLS was initiated due to server capability
			expect(mockSocket.startTls).toHaveBeenCalled()
		})

		it("should handle server without STARTTLS capability", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 HELP\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain"],
			})

			expect(mailer).toBeInstanceOf(WorkerMailer)
			// Verify that STARTTLS was not attempted
			expect(mockSocket.startTls).not.toHaveBeenCalled()
		})
	})

	describe("authentication", () => {
		it("should authenticate with PLAIN auth", async () => {
			// Mock successful connection and auth sequence
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain"],
			})

			// Verify AUTH PLAIN command was sent
			expect(mockWriter.write).toHaveBeenCalledWith(
				expect.any(Uint8Array), // Contains base64 encoded credentials
			)
		})

		it("should throw error on auth failure", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("535 Authentication failed\r\n"),
				})

			await expect(
				WorkerMailer.connect({
					host: "smtp.example.com",
					port: 587,
					username: "test@example.com",
					password: "wrong",
					authType: ["plain"],
				}),
			).rejects.toThrow(SmtpAuthError)
		})
	})

	describe("dsn", () => {
		it("should not send DSN if not supported", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain"],
				dsn: {
					RET: {
						HEADERS: true,
						FULL: false,
					},
					NOTIFY: {
						DELAY: true,
						FAILURE: true,
						SUCCESS: false,
					},
				},
			})

			await mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Email with DSN",
				text: "Hello World",
				dsnOverride: {
					envelopeId: "1234567890",
					RET: {
						HEADERS: false,
						FULL: true,
					},
					NOTIFY: {
						DELAY: false,
						FAILURE: false,
						SUCCESS: true,
					},
				},
			})

			const normalize = (str: string) => str.replace(/\s+/g, " ").trim()
			const calls = mockWriter.write.mock.calls.map(([arg]: [Uint8Array]) =>
				normalize(Buffer.from(arg).toString()),
			)

			expect(
				calls.some((call: string) => call.includes(normalize("MAIL FROM: <sender@example.com>"))),
			).toBe(true)
			expect(
				calls.some((call: string) => call.includes(normalize("RCPT TO: <recipient@example.com>"))),
			).toBe(true)
		})

		it("dsnOverride should override dsn", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250-AUTH=PLAIN LOGIN\r\n250 DSN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain"],
				dsn: {
					RET: {
						HEADERS: true,
						FULL: false,
					},
					NOTIFY: {
						DELAY: true,
						FAILURE: true,
						SUCCESS: false,
					},
				},
			})

			await mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Email with DSN",
				text: "Hello World",
				dsnOverride: {
					envelopeId: "1234567890",
					RET: {
						HEADERS: false,
						FULL: true,
					},
					NOTIFY: {
						DELAY: false,
						FAILURE: false,
						SUCCESS: true,
					},
				},
			})

			const normalize = (str: string) => str.replace(/\s+/g, " ").trim()
			const calls = mockWriter.write.mock.calls.map(([arg]: [Uint8Array]) =>
				normalize(Buffer.from(arg).toString()),
			)

			expect(
				calls.some((call: string) =>
					call.includes(normalize("MAIL FROM: <sender@example.com> RET=FULL ENVID=1234567890")),
				),
			).toBe(true)
			expect(
				calls.some((call: string) =>
					call.includes(normalize("RCPT TO: <recipient@example.com> NOTIFY=SUCCESS")),
				),
			).toBe(true)
		})

		it("should send email with DSN request", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250-AUTH=PLAIN LOGIN\r\n250 DSN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain"],
				dsn: {
					RET: {
						HEADERS: true,
						FULL: false,
					},
					NOTIFY: {
						DELAY: true,
						FAILURE: true,
						SUCCESS: true,
					},
				},
			})

			await mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Email with DSN",
				text: "This is a DSN test email",
				dsnOverride: {
					envelopeId: "1234567890",
				},
			})

			const normalize = (str: string) => str.replace(/\s+/g, " ").trim()
			const calls = mockWriter.write.mock.calls.map(([arg]: [Uint8Array]) =>
				normalize(Buffer.from(arg).toString()),
			)

			expect(
				calls.some((call: string) =>
					call.includes(normalize("RCPT TO: <recipient@example.com> NOTIFY=SUCCESS,FAILURE,DELAY")),
				),
			).toBe(true)
			expect(
				calls.some((call: string) =>
					call.includes(normalize("MAIL FROM: <sender@example.com> RET=HDRS ENVID=1234567890")),
				),
			).toBe(true)
		})
	})

	describe("email sending", () => {
		it("should send email successfully", async () => {
			// Mock successful connection, auth and send sequence
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain"],
			})

			await mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Email",
				text: "Hello World",
			})

			// Verify email commands were sent
			expect(mockWriter.write).toHaveBeenCalledWith(expect.any(Uint8Array)) // MAIL FROM
			expect(mockWriter.write).toHaveBeenCalledWith(expect.any(Uint8Array)) // RCPT TO
			expect(mockWriter.write).toHaveBeenCalledWith(expect.any(Uint8Array)) // DATA
			expect(mockWriter.write).toHaveBeenCalledWith(expect.any(Uint8Array)) // Email content
		})

		it("should handle recipient rejection", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("550 Recipient rejected\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain"],
				maxRetries: 0,
			})

			const sendPromise = mailer.send({
				from: "sender@example.com",
				to: "invalid@example.com",
				subject: "Test Email",
				text: "Hello World",
			})

			await expect(sendPromise).rejects.toThrow(SmtpCommandError)
		})
	})

	describe("close", () => {
		it("should close connection properly", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "test@example.com",
				password: "password",
				authType: ["plain"],
			})

			await mailer.close()

			expect(mockWriter.write).toHaveBeenCalledWith(expect.any(Uint8Array)) // QUIT command
			expect(mockSocket.close).toHaveBeenCalled()
		})
	})

	describe("security", () => {
		it("should throw when SMTP server closes connection unexpectedly", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain", "login"],
				maxRetries: 0,
			})

			// Simulate server closing connection (done: true)
			mockReader.read
				.mockResolvedValueOnce({ value: undefined, done: true })
				.mockResolvedValueOnce({ value: undefined, done: true })

			await expect(
				mailer.send({
					from: { email: "sender@example.com" },
					to: [{ email: "recipient@example.com" }],
					subject: "test",
					text: "test",
				}),
			).rejects.toThrow(SmtpConnectionError)

			await mailer.close()
		})

		it("should reject CRLF in email addresses (SMTP command injection)", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain", "login"],
			})

			await expect(
				mailer.send({
					from: { email: "attacker@evil.com\r\nRCPT TO: <victim@target.com>" },
					to: [{ email: "legit@example.com" }],
					subject: "test",
					text: "test",
				}),
			).rejects.toThrow(EmailValidationError)

			await mailer.close()
		})

		it("should reject CRLF in recipient email addresses", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain", "login"],
			})

			// MAIL FROM will succeed, then RCPT TO should fail with CRLF
			mockReader.read.mockResolvedValueOnce({
				value: new TextEncoder().encode("250 Sender OK\r\n"),
			})

			await expect(
				mailer.send({
					from: { email: "sender@example.com" },
					to: [{ email: "victim@target.com\r\nDATA" }],
					subject: "test",
					text: "test",
				}),
			).rejects.toThrow(EmailValidationError)

			await mailer.close()
		})

		it("should reject CRLF in DSN envelope ID", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250-DSN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 OK\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain", "login"],
				maxRetries: 0,
			})

			await expect(
				mailer.send({
					from: { email: "sender@example.com" },
					to: [{ email: "legit@example.com" }],
					subject: "test",
					text: "test",
					dsnOverride: { envelopeId: "id\r\nRCPT TO: <victim@evil.com>" },
				}),
			).rejects.toThrow(CrlfInjectionError)

			await mailer.close()
		})

		it("should reject DSN envelope ID with space (parameter injection)", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250-DSN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 OK\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain", "login"],
				maxRetries: 0,
			})

			await expect(
				mailer.send({
					from: { email: "sender@example.com" },
					to: [{ email: "legit@example.com" }],
					subject: "test",
					text: "test",
					dsnOverride: { envelopeId: "myid SIZE=999999999" },
				}),
			).rejects.toThrow(ConfigurationError)

			await mailer.close()
		})

		it("should reject DSN envelope ID with + or = characters", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250-DSN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 OK\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain", "login"],
				maxRetries: 0,
			})

			await expect(
				mailer.send({
					from: { email: "sender@example.com" },
					to: [{ email: "legit@example.com" }],
					subject: "test",
					text: "test",
					dsnOverride: { envelopeId: "id+injected=value" },
				}),
			).rejects.toThrow(ConfigurationError)

			await mailer.close()
		})
		it("should warn when CRAM-MD5 authentication is used", async () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH CRAM-MD5\r\n250 AUTH=CRAM-MD5\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("334 PDEyMzQ1QHNtdHAuZXhhbXBsZS5jb20+\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["cram-md5"],
			})

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("CRAM-MD5"))

			warnSpy.mockRestore()
		})
	})

	describe("retry", () => {
		it("should allow maxRetries option to be set", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				maxRetries: 5,
			})

			expect((mailer as unknown as { maxRetries: number }).maxRetries).toBe(5)

			await mailer.close()
		})

		it("should default maxRetries to 3", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})

			expect((mailer as unknown as { maxRetries: number }).maxRetries).toBe(3)

			await mailer.close()
		})

		it("should retry and succeed on second attempt", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				// 1st attempt: MAIL FROM OK, RCPT TO fails
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("451 Temporary failure\r\n"),
				})
				// RSET OK
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 OK\r\n"),
				})
				// 2nd attempt: all OK
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				maxRetries: 1,
			})

			await mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Retry Test",
				text: "Hello",
			})

			await mailer.close()
		})
	})

	describe("onFatalError hook", () => {
		it("should call onFatalError when a fatal error propagates from start()", async () => {
			const onFatalError = vi.fn()

			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				maxRetries: 0,
				hooks: { onFatalError },
			})

			// Send failure: MAIL FROM fails → RSET fails → close() → start() promise rejects
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("451 Temporary failure\r\n"),
				})
				// RSET also fails
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("500 RSET failed\r\n"),
				})

			const sendPromise = mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test",
				text: "Hello",
			})

			await expect(sendPromise).rejects.toThrow(SmtpCommandError)

			// onFatalError is called asynchronously in start()'s catch, so wait a bit
			await new Promise<void>((resolve) => setTimeout(resolve, 50))

			expect(onFatalError).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining("[WorkerMailer] RSET failed"),
				}),
			)
		})
	})

	describe("close race condition", () => {
		it("should reject send() after close() is called", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})

			await mailer.close()

			await expect(
				mailer.send({
					from: "sender@example.com",
					to: "recipient@example.com",
					subject: "Test",
					text: "After close",
				}),
			).rejects.toThrow(SmtpConnectionError)
		})

		it("should reject queued emails' sent promises when close() is called", async () => {
			// Block the first email send permanently so start() stays waiting on dequeue()
			let blockMailFrom: (() => void) | undefined
			const mailFromBlocked = new Promise<void>((resolve) => {
				blockMailFrom = resolve
			})

			mockReader.read
				// initializeSmtpSession: greet
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				// initializeSmtpSession: ehlo
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				// initializeSmtpSession: auth
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				// start() -> mail(): block permanently on first email send
				.mockImplementationOnce(
					() =>
						new Promise<{ value: Uint8Array }>((resolve) => {
							mailFromBlocked.then(() => {
								resolve({
									value: new TextEncoder().encode("250 OK\r\n"),
								})
							})
						}),
				)
				// close() -> QUIT response
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})
				// Subsequent read() calls return stream end (for start() loop cleanup)
				.mockResolvedValue({ value: undefined, done: true })

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})

			// Send the first email (start() dequeues it and blocks on MAIL FROM)
			const firstSent = mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "First",
				text: "First email",
			})
			firstSent.catch(() => {})

			// Wait for start() to begin processing the first email
			await new Promise<void>((resolve) => setTimeout(resolve, 50))

			// Add 2nd and 3rd emails to queue (they remain queued since start() is blocked on 1st MAIL FROM)
			const secondSent = mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Second",
				text: "Second email",
			})
			secondSent.catch(() => {})
			const thirdSent = mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Third",
				text: "Third email",
			})
			thirdSent.catch(() => {})

			// Call close() → 2nd and 3rd emails' sent promises in queue should be rejected
			await mailer.close()

			// Unblock (test cleanup)
			blockMailFrom?.()

			// 1st email should be setSentError'd in close() as emailSending
			await expect(firstSent).rejects.toThrow("[WorkerMailer] Mailer is shutting down")

			// 2nd and 3rd emails were in the queue, so they should be rejected by close()'s drain
			await expect(secondSent).rejects.toThrow("[WorkerMailer] Mailer is shutting down")
			await expect(thirdSent).rejects.toThrow("[WorkerMailer] Mailer is shutting down")
		})
	})

	describe("Symbol.asyncDispose", () => {
		it("should have Symbol.asyncDispose method", () => {
			expect(WorkerMailer.prototype[Symbol.asyncDispose]).toBeTypeOf("function")
		})

		it("should call close() when Symbol.asyncDispose is invoked", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})

			await mailer[Symbol.asyncDispose]()

			expect(mockSocket.close).toHaveBeenCalled()
		})
	})

	describe("send() returns SendResult", () => {
		it("should return SendResult with messageId and response", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 2.0.0 Ok: queued as ABC123\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})

			const result = await mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test",
				text: "Hello",
			})

			expect(result).toBeDefined()
			expect(result.messageId).toBeTruthy()
			expect(result.accepted).toContain("recipient@example.com")
			expect(result.rejected).toEqual([])
			expect(result.responseTime).toBeGreaterThanOrEqual(0)
			expect(result.response).toContain("250")

			await mailer.close()
		})

		it("should include all recipients in accepted", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})

			const result = await mailer.send({
				from: "sender@example.com",
				to: ["a@example.com", "b@example.com"],
				subject: "Test",
				text: "Hello",
			})

			expect(result.accepted).toEqual(["a@example.com", "b@example.com"])

			await mailer.close()
		})
	})

	describe("autoReconnect", () => {
		it("should store autoReconnect option", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				autoReconnect: true,
			})

			expect((mailer as unknown as { autoReconnect: boolean }).autoReconnect).toBe(true)

			await mailer.close()
		})

		it("should default autoReconnect to false", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})

			expect((mailer as unknown as { autoReconnect: boolean }).autoReconnect).toBe(false)

			await mailer.close()
		})

		it("should reconnect and send successfully after connection drop", async () => {
			// Initial connection
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			let reconnectSocketReader: MockReader
			let reconnectSocketWriter: MockWriter
			const reconnectSocket: MockSocket = {
				readable: {
					getReader: () => {
						return reconnectSocketReader
					},
				},
				writable: {
					getWriter: () => {
						return reconnectSocketWriter
					},
				},
				opened: Promise.resolve(),
				close: vi.fn(),
				startTls: vi.fn(),
			}

			reconnectSocketReader = {
				read: vi.fn(),
				releaseLock: vi.fn(),
			}
			reconnectSocketWriter = {
				write: vi.fn(),
				releaseLock: vi.fn(),
			}

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				autoReconnect: true,
				maxRetries: 1,
			})

			// 1st send attempt: connection drop (connection lost at MAIL FROM)
			mockReader.read.mockResolvedValueOnce({ value: undefined, done: true })
			// RSET also fails (due to disconnection)
			mockReader.read.mockResolvedValueOnce({ value: undefined, done: true })

			// On reconnect: connect() returns a new socket
			vi.mocked(connect).mockReturnValueOnce(
				reconnectSocket as unknown as ReturnType<typeof connect>,
			)

			// initializeSmtpSession on reconnect
			reconnectSocketReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				// Successful send after reconnect
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				// close
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const result = await mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Reconnect Test",
				text: "Hello after reconnect",
			})

			expect(result).toBeDefined()
			expect(result.accepted).toContain("recipient@example.com")

			await mailer.close()
		})
	})

	describe("SMTP communication verification (B-C3)", () => {
		it("should send MAIL FROM, RCPT TO, DATA, body in correct order", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})

			await mailer.send({
				from: "from@example.com",
				to: "to@example.com",
				subject: "Verify SMTP",
				text: "Body content",
			})

			const calls = mockWriter.write.mock.calls.map(([arg]: [Uint8Array]) =>
				Buffer.from(arg).toString(),
			)
			const ehloIdx = calls.findIndex((c: string) => c.startsWith("EHLO"))
			const authIdx = calls.findIndex((c: string) => c.startsWith("AUTH PLAIN"))
			const mailIdx = calls.findIndex((c: string) => c.startsWith("MAIL FROM:"))
			const rcptIdx = calls.findIndex((c: string) => c.startsWith("RCPT TO:"))
			const dataIdx = calls.findIndex((c: string) => c === "DATA\r\n")
			const bodyIdx = calls.findIndex((c: string) => c.includes("\r\n.\r\n"))

			expect(ehloIdx).toBeLessThan(authIdx)
			expect(authIdx).toBeLessThan(mailIdx)
			expect(mailIdx).toBeLessThan(rcptIdx)
			expect(rcptIdx).toBeLessThan(dataIdx)
			expect(dataIdx).toBeLessThan(bodyIdx)

			expect(calls[mailIdx]).toContain("<from@example.com>")
			expect(calls[rcptIdx]).toContain("<to@example.com>")
			expect(calls[bodyIdx]).toContain("Body content")

			await mailer.close()
		})
	})

	describe("PLAIN auth Base64 verification (B-C4)", () => {
		it("should send correctly structured AUTH PLAIN payload", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "testuser",
				password: "testpass",
				authType: ["plain"],
			})

			const calls = mockWriter.write.mock.calls.map(([arg]: [Uint8Array]) =>
				Buffer.from(arg).toString(),
			)
			const authCall = calls.find((c: string) => c.startsWith("AUTH PLAIN"))
			expect(authCall).toBeDefined()
			const b64Part = authCall?.replace("AUTH PLAIN ", "").replace("\r\n", "")
			const decoded = atob(b64Part)
			expect(decoded).toBe("\0testuser\0testpass")
		})
	})

	describe("LOGIN auth challenge-response (B-H5)", () => {
		it("should complete LOGIN auth with 334 challenge-response flow", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH LOGIN\r\n250 AUTH=LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("334 VXNlcm5hbWU6\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("334 UGFzc3dvcmQ6\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "loginuser",
				password: "loginpass",
				authType: ["login"],
			})
			expect(mailer).toBeInstanceOf(WorkerMailer)
			await mailer.close()
		})
	})

	describe("responseTimeoutMs (B-H6)", () => {
		it("should timeout when server does not respond", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockImplementation(() => new Promise(() => {}))

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				responseTimeoutMs: 100,
				maxRetries: 0,
			})

			await expect(
				mailer.send({
					from: "a@b.com",
					to: "c@d.com",
					subject: "Timeout",
					text: "body",
				}),
			).rejects.toThrow(SmtpConnectionError)
		})
	})

	describe("fragmented responses (B-H7)", () => {
		it("should handle greeting split across multiple reads", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.exa"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("mple.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})
			expect(mailer).toBeInstanceOf(WorkerMailer)
			await mailer.close()
		})

		it("should handle EHLO continuation lines split across reads", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250-smtp.example.com\r\n250-AUTH PLAIN"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(" LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})
			expect(mailer).toBeInstanceOf(WorkerMailer)
			await mailer.close()
		})
	})

	describe("4xx/5xx response distinction (B-H8)", () => {
		it("should retry on 451 and succeed on second attempt", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("451 Try again later\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 RSET OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				maxRetries: 1,
			})

			const result = await mailer.send({
				from: "a@b.com",
				to: "c@d.com",
				subject: "Retry",
				text: "body",
			})
			expect(result.accepted).toContain("c@d.com")
			await mailer.close()
		})

		it("should fail immediately on 550 with maxRetries=0", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("550 User not found\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				maxRetries: 0,
			})

			await expect(
				mailer.send({
					from: "a@b.com",
					to: "bad@d.com",
					subject: "Fail",
					text: "body",
				}),
			).rejects.toThrow(SmtpCommandError)
		})

		it("should exhaust retries on persistent 550", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("550 Rejected\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 RSET OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("550 Rejected\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				maxRetries: 1,
			})

			await expect(
				mailer.send({
					from: "a@b.com",
					to: "bad@d.com",
					subject: "Exhaust",
					text: "body",
				}),
			).rejects.toThrow()
		})
	})

	describe("reconnect all-fail (B-H9)", () => {
		it("should call onFatalError when all reconnect attempts fail", async () => {
			const onFatalError = vi.fn()

			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				autoReconnect: true,
				maxRetries: 1,
				socketTimeoutMs: 200,
				responseTimeoutMs: 200,
				hooks: { onFatalError },
			})

			mockReader.read
				.mockResolvedValueOnce({ value: undefined, done: true })
				.mockResolvedValueOnce({ value: undefined, done: true })

			const failSocket = {
				readable: {
					getReader: () => ({
						read: vi.fn().mockResolvedValue({ value: undefined, done: true }),
						releaseLock: vi.fn(),
					}),
				},
				writable: {
					getWriter: () => ({
						write: vi.fn(),
						releaseLock: vi.fn(),
					}),
				},
				opened: new Promise<void>((_, reject) => {
					setTimeout(() => reject(new Error("refused")), 0)
				}),
				close: vi.fn(),
				startTls: vi.fn(),
			}
			failSocket.opened.catch(() => {})
			vi.mocked(connect).mockReturnValue(failSocket as unknown as ReturnType<typeof connect>)

			const sendPromise = mailer.send({
				from: "a@b.com",
				to: "c@d.com",
				subject: "Reconnect fail",
				text: "body",
			})
			await expect(sendPromise).rejects.toThrow()
			await new Promise<void>((resolve) => setTimeout(resolve, 6000))
			expect(onFatalError).toHaveBeenCalled()
		}, 15_000)
	})

	describe("malformed server responses (B-H-X1)", () => {
		it("should reject non-220 greeting", async () => {
			mockReader.read.mockResolvedValueOnce({
				value: new TextEncoder().encode("421 Service not available\r\n"),
			})

			await expect(
				WorkerMailer.connect({
					host: "smtp.example.com",
					port: 587,
					responseTimeoutMs: 500,
				}),
			).rejects.toThrow(SmtpConnectionError)
		})

		it("should reject empty greeting (connection closed)", async () => {
			mockReader.read.mockResolvedValueOnce({ value: undefined, done: true })

			await expect(
				WorkerMailer.connect({
					host: "smtp.example.com",
					port: 587,
					responseTimeoutMs: 500,
				}),
			).rejects.toThrow(SmtpConnectionError)
		})

		it("should handle greeting with unusual 220 message", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 localhost ESMTP\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 localhost\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				responseTimeoutMs: 500,
			})
			expect(mailer).toBeInstanceOf(WorkerMailer)
			await mailer.close()
		})
	})

	describe("concurrent sends (B-M5)", () => {
		it("should process concurrent sends through queue", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			for (let i = 0; i < 3; i++) {
				mockReader.read
					.mockResolvedValueOnce({
						value: new TextEncoder().encode("250 Sender OK\r\n"),
					})
					.mockResolvedValueOnce({
						value: new TextEncoder().encode("250 Recipient OK\r\n"),
					})
					.mockResolvedValueOnce({
						value: new TextEncoder().encode("354 Start mail input\r\n"),
					})
					.mockResolvedValueOnce({
						value: new TextEncoder().encode("250 Message accepted\r\n"),
					})
			}
			mockReader.read.mockResolvedValueOnce({
				value: new TextEncoder().encode("221 Bye\r\n"),
			})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
			})

			const results = await Promise.all([
				mailer.send({
					from: "a@b.com",
					to: "r1@d.com",
					subject: "C1",
					text: "body1",
				}),
				mailer.send({
					from: "a@b.com",
					to: "r2@d.com",
					subject: "C2",
					text: "body2",
				}),
				mailer.send({
					from: "a@b.com",
					to: "r3@d.com",
					subject: "C3",
					text: "body3",
				}),
			])

			expect(results).toHaveLength(3)
			for (const result of results) {
				expect(result.accepted.length).toBe(1)
			}
			await mailer.close()
		})
	})

	describe("hooks integration (B-M6)", () => {
		it("should call onConnected on successful connection", async () => {
			const onConnected = vi.fn()

			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				hooks: { onConnected },
			})

			expect(onConnected).toHaveBeenCalledWith({
				host: "smtp.example.com",
				port: 587,
			})
			await mailer.close()
		})

		it("should call onDisconnected on close", async () => {
			const onDisconnected = vi.fn()

			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				hooks: { onDisconnected },
			})

			await mailer.close()
			expect(onDisconnected).toHaveBeenCalledWith({ reason: undefined })
		})

		it("should call beforeSend and allow modification", async () => {
			const beforeSend = vi.fn().mockImplementation((opts: unknown) => opts)

			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				hooks: { beforeSend },
			})

			await mailer.send({
				from: "a@b.com",
				to: "c@d.com",
				subject: "Hook",
				text: "body",
			})
			expect(beforeSend).toHaveBeenCalledTimes(1)
			await mailer.close()
		})

		it("should cancel send when beforeSend returns false", async () => {
			const beforeSend = vi.fn().mockReturnValue(false)

			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				hooks: { beforeSend },
			})

			await expect(
				mailer.send({
					from: "a@b.com",
					to: "c@d.com",
					subject: "Cancelled",
					text: "body",
				}),
			).rejects.toThrow("cancelled")
			await mailer.close()
		})

		it("should call afterSend on success", async () => {
			const afterSend = vi.fn()

			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Sender OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Recipient OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("354 Start mail input\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 Message accepted\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				hooks: { afterSend },
			})

			await mailer.send({
				from: "a@b.com",
				to: "c@d.com",
				subject: "AfterSend",
				text: "body",
			})
			expect(afterSend).toHaveBeenCalledTimes(1)
			expect(afterSend).toHaveBeenCalledWith(
				expect.objectContaining({ subject: "AfterSend" }),
				expect.objectContaining({ accepted: ["c@d.com"] }),
			)
			await mailer.close()
		})

		it("should call onSendError when send fails", async () => {
			const onSendError = vi.fn()

			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("550 Rejected\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 RSET OK\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				maxRetries: 0,
				hooks: { onSendError },
			})

			await expect(
				mailer.send({
					from: "a@b.com",
					to: "c@d.com",
					subject: "FailHook",
					text: "body",
				}),
			).rejects.toThrow()

			await new Promise<void>((resolve) => setTimeout(resolve, 50))
			expect(onSendError).toHaveBeenCalledTimes(1)
		})
	})

	describe("retry behavior verification (B-L2)", () => {
		it("should retry the configured number of times before failing", async () => {
			mockReader.read
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode(
						"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
					),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("235 Authentication successful\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("451 Temp error\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 RSET OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("451 Temp error\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 RSET OK\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("451 Temp error\r\n"),
				})
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("250 RSET OK\r\n"),
				})

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				username: "user",
				password: "pass",
				authType: ["plain"],
				maxRetries: 2,
			})

			await expect(
				mailer.send({
					from: "a@b.com",
					to: "c@d.com",
					subject: "Retry exhaust",
					text: "body",
				}),
			).rejects.toThrow(/max retries/)
		})
	})
})

describe("WorkerMailerPool", () => {
	interface MockReader {
		read: Mock
		releaseLock: Mock
	}
	interface MockWriter {
		write: Mock
		releaseLock: Mock
	}
	interface MockSocket {
		readable: { getReader: () => MockReader }
		writable: { getWriter: () => MockWriter }
		opened: Promise<void>
		close: Mock
		startTls: Mock
	}

	let mockSockets: MockSocket[]

	function createMockSocket(): MockSocket {
		const mockReader: MockReader = {
			read: vi.fn(),
			releaseLock: vi.fn(),
		}
		const mockWriter: MockWriter = {
			write: vi.fn(),
			releaseLock: vi.fn(),
		}
		return {
			readable: { getReader: () => mockReader },
			writable: { getWriter: () => mockWriter },
			opened: Promise.resolve(),
			close: vi.fn(),
			startTls: vi.fn().mockReturnValue({
				readable: { getReader: () => mockReader },
				writable: { getWriter: () => mockWriter },
			}),
		}
	}

	function setupConnectionMocks(socket: MockSocket): void {
		const reader = socket.readable.getReader()
		reader.read
			.mockResolvedValueOnce({
				value: new TextEncoder().encode("220 smtp.example.com ready\r\n"),
			})
			.mockResolvedValueOnce({
				value: new TextEncoder().encode(
					"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n",
				),
			})
			.mockResolvedValueOnce({
				value: new TextEncoder().encode("235 Authentication successful\r\n"),
			})
	}

	beforeEach(() => {
		vi.clearAllMocks()
		mockSockets = []

		vi.mocked(connect).mockImplementation(() => {
			const socket = createMockSocket()
			setupConnectionMocks(socket)
			mockSockets.push(socket)
			return socket as unknown as ReturnType<typeof connect>
		})
	})

	const poolOptions = {
		host: "smtp.example.com",
		port: 587,
		username: "user",
		password: "pass",
		authType: ["plain"] as const,
	}

	describe("connect", () => {
		it("should create multiple connections based on poolSize", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 4 })
			await pool.connect()

			expect(connect).toHaveBeenCalledTimes(4)

			await pool.close()
		})

		it("should default poolSize to 3", async () => {
			const pool = new WorkerMailerPool(poolOptions)
			await pool.connect()

			expect(connect).toHaveBeenCalledTimes(3)

			await pool.close()
		})
	})

	describe("send", () => {
		it("should distribute sends across connections in round-robin", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 3 })
			await pool.connect()

			const emailOptions = {
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test",
				text: "Hello",
			}

			// Set up send mocks for each of the 3 sockets
			for (const socket of mockSockets) {
				const reader = socket.readable.getReader()
				// Responses for MAIL FROM, RCPT TO, DATA, BODY
				reader.read
					.mockResolvedValueOnce({
						value: new TextEncoder().encode("250 OK\r\n"),
					})
					.mockResolvedValueOnce({
						value: new TextEncoder().encode("250 OK\r\n"),
					})
					.mockResolvedValueOnce({
						value: new TextEncoder().encode("354 Start mail input\r\n"),
					})
					.mockResolvedValueOnce({
						value: new TextEncoder().encode("250 OK\r\n"),
					})
			}

			// Send 3 emails → should be distributed 1 per connection
			await pool.send(emailOptions)
			await pool.send(emailOptions)
			await pool.send(emailOptions)

			// Verify writes were made to each socket's writer
			for (const socket of mockSockets) {
				const writer = socket.writable.getWriter()
				// EHLO + AUTH PLAIN on connect + MAIL FROM, RCPT TO, DATA, BODY on send
				expect(writer.write.mock.calls.length).toBeGreaterThanOrEqual(4)
			}

			await pool.close()
		})

		it("should reject when pool is not connected", async () => {
			const pool = new WorkerMailerPool(poolOptions)

			await expect(
				pool.send({
					from: "sender@example.com",
					to: "recipient@example.com",
					subject: "Test",
					text: "Hello",
				}),
			).rejects.toThrow(SmtpConnectionError)
		})
	})

	describe("close", () => {
		it("should close all connections", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 2 })
			await pool.connect()

			// QUIT + response mock for close
			for (const socket of mockSockets) {
				const reader = socket.readable.getReader()
				reader.read.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})
			}

			await pool.close()

			for (const socket of mockSockets) {
				expect(socket.close).toHaveBeenCalled()
			}
		})
	})

	describe("Symbol.asyncDispose", () => {
		it("should have Symbol.asyncDispose method", () => {
			expect(WorkerMailerPool.prototype[Symbol.asyncDispose]).toBeTypeOf("function")
		})

		it("should call close() when Symbol.asyncDispose is invoked", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 2 })
			await pool.connect()

			for (const socket of mockSockets) {
				const reader = socket.readable.getReader()
				reader.read.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})
			}

			await pool[Symbol.asyncDispose]()

			for (const socket of mockSockets) {
				expect(socket.close).toHaveBeenCalled()
			}
		})
	})

	describe("round-robin distribution (B-M7)", () => {
		it("should distribute 4 emails across 3 sockets as 1→2→3→1", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 3 })
			await pool.connect()

			const recipients = ["r1@d.com", "r2@d.com", "r3@d.com", "r4@d.com"]

			for (const socket of mockSockets) {
				const reader = socket.readable.getReader()
				for (let i = 0; i < 2; i++) {
					reader.read
						.mockResolvedValueOnce({
							value: new TextEncoder().encode("250 OK\r\n"),
						})
						.mockResolvedValueOnce({
							value: new TextEncoder().encode("250 OK\r\n"),
						})
						.mockResolvedValueOnce({
							value: new TextEncoder().encode("354 Start mail input\r\n"),
						})
						.mockResolvedValueOnce({
							value: new TextEncoder().encode("250 OK\r\n"),
						})
				}
			}

			for (const rcpt of recipients) {
				await pool.send({
					from: "sender@example.com",
					to: rcpt,
					subject: "RR Test",
					text: "body",
				})
			}

			const rcptsBySocket: string[][] = []
			for (const socket of mockSockets) {
				const writer = socket.writable.getWriter()
				const rcpts = writer.write.mock.calls
					.map(([arg]: [Uint8Array]) => Buffer.from(arg).toString())
					.filter((c: string) => c.startsWith("RCPT TO:"))
					.map((c: string) => {
						const match = c.match(/<([^>]+)>/)
						return match ? match[1] : ""
					})
				rcptsBySocket.push(rcpts)
			}

			expect(rcptsBySocket[0]).toContain("r1@d.com")
			expect(rcptsBySocket[1]).toContain("r2@d.com")
			expect(rcptsBySocket[2]).toContain("r3@d.com")
			expect(rcptsBySocket[0]).toContain("r4@d.com")

			await pool.close()
		})
	})
})

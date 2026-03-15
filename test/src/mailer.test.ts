import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
			).rejects.toThrow("[WorkerMailer] Connection timeout: socket connection timed out")
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
				credentials: { username: "user", password: "pass" },
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
				credentials: { username: "user", password: "pass" },
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
				credentials: { username: "user", password: "pass" },
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
					credentials: {
						username: "test@example.com",
						password: "wrong",
					},
					authType: ["plain"],
				}),
			).rejects.toThrow("[WorkerMailer] PLAIN authentication failed")
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
				authType: ["plain"],
				maxRetries: 0,
			})

			const sendPromise = mailer.send({
				from: "sender@example.com",
				to: "invalid@example.com",
				subject: "Test Email",
				text: "Hello World",
			})

			await expect(sendPromise).rejects.toThrow("[WorkerMailer] RCPT TO failed")
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
				credentials: {
					username: "test@example.com",
					password: "password",
				},
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
				credentials: { username: "user", password: "pass" },
				authType: ["plain", "login"],
				maxRetries: 0,
			})

			// Simulate server closing connection (done: true)
			mockReader.read.mockResolvedValueOnce({ value: undefined, done: true })

			await expect(
				mailer.send({
					from: { email: "sender@example.com" },
					to: [{ email: "recipient@example.com" }],
					subject: "test",
					text: "test",
				}),
			).rejects.toThrow(/Connection closed/)

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
				credentials: { username: "user", password: "pass" },
				authType: ["plain", "login"],
			})

			expect(() =>
				mailer.send({
					from: { email: "attacker@evil.com\r\nRCPT TO: <victim@target.com>" },
					to: [{ email: "legit@example.com" }],
					subject: "test",
					text: "test",
				}),
			).toThrow(/Invalid email address/)

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
				credentials: { username: "user", password: "pass" },
				authType: ["plain", "login"],
			})

			// MAIL FROM will succeed, then RCPT TO should fail with CRLF
			mockReader.read.mockResolvedValueOnce({
				value: new TextEncoder().encode("250 Sender OK\r\n"),
			})

			expect(() =>
				mailer.send({
					from: { email: "sender@example.com" },
					to: [{ email: "victim@target.com\r\nDATA" }],
					subject: "test",
					text: "test",
				}),
			).toThrow(/Invalid email address/)

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

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				credentials: { username: "user", password: "pass" },
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
			).rejects.toThrow(/CRLF injection/)

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
				credentials: { username: "user", password: "pass" },
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
				credentials: { username: "user", password: "pass" },
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
				credentials: { username: "user", password: "pass" },
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
				credentials: { username: "user", password: "pass" },
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

	describe("onError callback", () => {
		it("should call onError when a fatal error propagates from start()", async () => {
			const onError = vi.fn()

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
				credentials: { username: "user", password: "pass" },
				authType: ["plain"],
				maxRetries: 0,
				onError,
			})

			// 送信失敗: MAIL FROM fails → RSET fails → close() → start() promise rejects
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

			await expect(sendPromise).rejects.toThrow("[WorkerMailer] MAIL FROM failed")

			// onError は start() の catch で非同期に呼ばれるので少し待つ
			await new Promise<void>((resolve) => setTimeout(resolve, 50))

			expect(onError).toHaveBeenCalledWith(
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
				credentials: { username: "user", password: "pass" },
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
			).rejects.toThrow("[WorkerMailer] Send failed: mailer is closed")
		})

		it("should reject queued emails' sent promises when close() is called", async () => {
			// start() が dequeue() で待機中に止まるよう、最初のメール送信を永久にブロックする
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
				// start() -> mail(): 最初のメール送信で永久に待機させる
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
				// close() -> QUIT 応答
				.mockResolvedValueOnce({
					value: new TextEncoder().encode("221 Bye\r\n"),
				})
				// 以降の read() は stream 終了を返す（start() ループのクリーンアップ用）
				.mockResolvedValue({ value: undefined, done: true })

			const mailer = await WorkerMailer.connect({
				host: "smtp.example.com",
				port: 587,
				credentials: { username: "user", password: "pass" },
				authType: ["plain"],
			})

			// 最初のメールを送信（start() がこれを dequeue して MAIL FROM で待機状態になる）
			const firstSent = mailer.send({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "First",
				text: "First email",
			})
			firstSent.catch(() => {})

			// start() が最初のメールを処理し始めるのを待つ
			await new Promise<void>((resolve) => setTimeout(resolve, 50))

			// キューに2通目・3通目を追加（start() は1通目の MAIL FROM で待機中なのでキューに残る）
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

			// close() を呼ぶ → キュー内の2通目・3通目の sent が reject されるべき
			await mailer.close()

			// ブロック解除（テストのクリーンアップ）
			blockMailFrom?.()

			// 1通目は emailSending として close() 内で setSentError されるべき
			await expect(firstSent).rejects.toThrow("[WorkerMailer] Mailer is shutting down")

			// 2通目・3通目はキュー内にあったため、close() のドレインで reject されるべき
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
				credentials: { username: "user", password: "pass" },
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
				credentials: { username: "user", password: "pass" },
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
				credentials: { username: "user", password: "pass" },
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
				credentials: { username: "user", password: "pass" },
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
				credentials: { username: "user", password: "pass" },
				authType: ["plain"],
			})

			expect((mailer as unknown as { autoReconnect: boolean }).autoReconnect).toBe(false)

			await mailer.close()
		})

		it("should reconnect and send successfully after connection drop", async () => {
			// 初回接続
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
				credentials: { username: "user", password: "pass" },
				authType: ["plain"],
				autoReconnect: true,
				maxRetries: 1,
			})

			// 送信試行1回目: 接続断（MAIL FROM で接続が切れる）
			mockReader.read.mockResolvedValueOnce({ value: undefined, done: true })
			// RSET も失敗（接続切断なので）
			mockReader.read.mockResolvedValueOnce({ value: undefined, done: true })

			// 再接続時: connect() が新しいソケットを返す
			vi.mocked(connect).mockReturnValueOnce(
				reconnectSocket as unknown as ReturnType<typeof connect>,
			)

			// 再接続時の initializeSmtpSession
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
				// 再接続後の送信成功
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
		credentials: { username: "user", password: "pass" },
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

			// 3つのソケットにそれぞれ送信用モックを設定
			for (const socket of mockSockets) {
				const reader = socket.readable.getReader()
				// MAIL FROM, RCPT TO, DATA, BODY の各レスポンス
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

			// 3通送信 → 各コネクションに1通ずつ分散されるべき
			await pool.send(emailOptions)
			await pool.send(emailOptions)
			await pool.send(emailOptions)

			// 各ソケットの writer に書き込みが行われたことを確認
			for (const socket of mockSockets) {
				const writer = socket.writable.getWriter()
				// 接続時の EHLO + AUTH PLAIN + 送信時の MAIL FROM, RCPT TO, DATA, BODY
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
			).rejects.toThrow("[WorkerMailerPool] Send failed: pool is not connected")
		})
	})

	describe("close", () => {
		it("should close all connections", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 2 })
			await pool.connect()

			// close 時の QUIT + レスポンス用モック
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
})

import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import { sendBatch } from "../../src/batch"
import type { EmailOptions } from "../../src/email"
import { WorkerMailer } from "../../src/mailer"

vi.mock("cloudflare:sockets", () => ({
	connect: vi.fn(),
}))

describe("sendBatch", () => {
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

	function setupConnectionMocks() {
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
	}

	function setupSendSuccess() {
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

	function setupSendFailure() {
		mockReader.read.mockResolvedValueOnce({
			value: new TextEncoder().encode("550 Rejected\r\n"),
		})
	}

	const connectionOptions = {
		host: "smtp.example.com",
		port: 587,
		credentials: { username: "user", password: "pass" },
		authType: ["plain"] as const,
		maxRetries: 0,
	}

	const makeEmail = (subject: string): EmailOptions => ({
		from: "sender@example.com",
		to: "recipient@example.com",
		subject,
		text: "Hello",
	})

	beforeEach(() => {
		vi.clearAllMocks()

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

		vi.mocked(connect).mockReturnValue(mockSocket as unknown as ReturnType<typeof connect>)
	})

	it("複数メール送信が全成功するケース", async () => {
		setupConnectionMocks()
		setupSendSuccess()
		setupSendSuccess()
		setupSendSuccess()
		mockReader.read.mockResolvedValueOnce({
			value: new TextEncoder().encode("221 Bye\r\n"),
		})

		const mailer = await WorkerMailer.connect(connectionOptions)

		const emails = [makeEmail("Email 1"), makeEmail("Email 2"), makeEmail("Email 3")]
		const results = await sendBatch(mailer, emails)

		expect(results).toHaveLength(3)
		for (const r of results) {
			expect(r.success).toBe(true)
			expect(r.result).toBeDefined()
			expect(r.result?.response).toContain("250")
			expect(r.error).toBeUndefined()
		}

		await mailer.close()
	})

	it("一部失敗するケース（continueOnError: true）", async () => {
		setupConnectionMocks()
		// 1通目: 成功
		setupSendSuccess()
		// 2通目: MAIL FROM 失敗 + RSET成功
		setupSendFailure()
		mockReader.read.mockResolvedValueOnce({
			value: new TextEncoder().encode("250 OK\r\n"),
		})
		// 3通目: 成功
		setupSendSuccess()
		mockReader.read.mockResolvedValueOnce({
			value: new TextEncoder().encode("221 Bye\r\n"),
		})

		const mailer = await WorkerMailer.connect(connectionOptions)

		const emails = [makeEmail("Email 1"), makeEmail("Email 2"), makeEmail("Email 3")]
		const results = await sendBatch(mailer, emails, { continueOnError: true })

		expect(results).toHaveLength(3)
		expect(results[0].success).toBe(true)
		expect(results[0].result).toBeDefined()
		expect(results[1].success).toBe(false)
		expect(results[1].error).toBeDefined()
		expect(results[2].success).toBe(true)
		expect(results[2].result).toBeDefined()

		await mailer.close()
	})

	it("全停止するケース（continueOnError: false）", async () => {
		setupConnectionMocks()
		// 1通目: 成功
		setupSendSuccess()
		// 2通目: MAIL FROM 失敗 + RSET成功
		setupSendFailure()
		mockReader.read.mockResolvedValueOnce({
			value: new TextEncoder().encode("250 OK\r\n"),
		})
		mockReader.read.mockResolvedValueOnce({
			value: new TextEncoder().encode("221 Bye\r\n"),
		})

		const mailer = await WorkerMailer.connect(connectionOptions)

		const emails = [makeEmail("Email 1"), makeEmail("Email 2"), makeEmail("Email 3")]
		const results = await sendBatch(mailer, emails, { continueOnError: false })

		expect(results).toHaveLength(2)
		expect(results[0].success).toBe(true)
		expect(results[1].success).toBe(false)
		expect(results[1].error).toBeDefined()

		await mailer.close()
	})

	it("空リストのケース", async () => {
		setupConnectionMocks()
		mockReader.read.mockResolvedValueOnce({
			value: new TextEncoder().encode("221 Bye\r\n"),
		})

		const mailer = await WorkerMailer.connect(connectionOptions)

		const results = await sendBatch(mailer, [])

		expect(results).toHaveLength(0)

		await mailer.close()
	})
})

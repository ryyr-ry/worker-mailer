import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import { WorkerMailer, WorkerMailerPool } from "../../src/mailer"
import { MockMailer } from "../../src/mock"

vi.mock("cloudflare:sockets", () => ({
	connect: vi.fn(),
}))

describe("ping()", () => {
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

	const encode = (s: string) => new TextEncoder().encode(s)

	function setupConnection() {
		mockReader.read
			.mockResolvedValueOnce({ value: encode("220 smtp.example.com ready\r\n") })
			.mockResolvedValueOnce({
				value: encode("250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n"),
			})
			.mockResolvedValueOnce({ value: encode("235 Authentication successful\r\n") })
	}

	const baseOptions = {
		host: "smtp.example.com",
		port: 587,
		username: "user",
		password: "pass",
		authType: ["plain"] as const,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		mockReader = { read: vi.fn(), releaseLock: vi.fn() }
		mockWriter = { write: vi.fn(), releaseLock: vi.fn() }
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

	it("returns true on healthy connection", async () => {
		setupConnection()
		mockReader.read.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
		mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

		const mailer = await WorkerMailer.connect(baseOptions)
		const result = await mailer.ping()
		expect(result).toBe(true)
		await mailer.close()
	})

	it("returns false when disconnected", async () => {
		setupConnection()
		mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

		const mailer = await WorkerMailer.connect(baseOptions)
		await mailer.close()
		const result = await mailer.ping()
		expect(result).toBe(false)
	})

	it("returns false on non-250 response", async () => {
		setupConnection()
		mockReader.read.mockResolvedValueOnce({ value: encode("500 Error\r\n") })
		mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

		const mailer = await WorkerMailer.connect(baseOptions)
		const result = await mailer.ping()
		expect(result).toBe(false)
		await mailer.close()
	})

	it("returns false on timeout", async () => {
		setupConnection()
		mockReader.read.mockImplementationOnce(
			() => new Promise((resolve) => setTimeout(() => resolve({ done: true }), 60_000)),
		)

		const mailer = await WorkerMailer.connect({
			...baseOptions,
			responseTimeoutMs: 10,
		})
		const result = await mailer.ping()
		expect(result).toBe(false)
		await mailer.close()
	})

	describe("Pool", () => {
		it("returns true when all connections healthy", async () => {
			// Pool connections run concurrently via Promise.all, so reads interleave
			mockReader.read
				.mockResolvedValueOnce({ value: encode("220 smtp.example.com ready\r\n") })
				.mockResolvedValueOnce({ value: encode("220 smtp.example.com ready\r\n") })
				.mockResolvedValueOnce({
					value: encode("250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n"),
				})
				.mockResolvedValueOnce({
					value: encode("250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n"),
				})
				.mockResolvedValueOnce({ value: encode("235 Authentication successful\r\n") })
				.mockResolvedValueOnce({ value: encode("235 Authentication successful\r\n") })
				.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
				.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
				.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })
				.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const pool = new WorkerMailerPool({ ...baseOptions, poolSize: 2 })
			await pool.connect()
			const result = await pool.ping()
			expect(result).toBe(true)
			await pool.close()
		})

		it("returns false when any connection fails", async () => {
			mockReader.read
				.mockResolvedValueOnce({ value: encode("220 smtp.example.com ready\r\n") })
				.mockResolvedValueOnce({ value: encode("220 smtp.example.com ready\r\n") })
				.mockResolvedValueOnce({
					value: encode("250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n"),
				})
				.mockResolvedValueOnce({
					value: encode("250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n"),
				})
				.mockResolvedValueOnce({ value: encode("235 Authentication successful\r\n") })
				.mockResolvedValueOnce({ value: encode("235 Authentication successful\r\n") })
				.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
				.mockResolvedValueOnce({ value: encode("500 Error\r\n") })
				.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })
				.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const pool = new WorkerMailerPool({ ...baseOptions, poolSize: 2 })
			await pool.connect()
			const result = await pool.ping()
			expect(result).toBe(false)
			await pool.close()
		})
	})

	it("sends NOOP command to SMTP server", async () => {
		setupConnection()
		mockReader.read.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
		mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

		const mailer = await WorkerMailer.connect(baseOptions)
		await mailer.ping()

		const writeArgs = mockWriter.write.mock.calls.map((call: [Uint8Array]) =>
			new TextDecoder().decode(call[0]),
		)
		expect(writeArgs).toContainEqual(expect.stringContaining("NOOP\r\n"))
		await mailer.close()
	})

	it("consecutive pings both succeed", async () => {
		setupConnection()
		mockReader.read
			.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
			.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
			.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

		const mailer = await WorkerMailer.connect(baseOptions)
		const result1 = await mailer.ping()
		const result2 = await mailer.ping()
		expect(result1).toBe(true)
		expect(result2).toBe(true)
		await mailer.close()
	})

	describe("MockMailer", () => {
		it("returns true when connected", async () => {
			const mailer = new MockMailer()
			expect(await mailer.ping()).toBe(true)
			await mailer.close()
			expect(await mailer.ping()).toBe(false)
		})
	})
})

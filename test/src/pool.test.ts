import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import { SmtpConnectionError } from "../../src/errors"
import { WorkerMailerPool } from "../../src/mailer"

vi.mock("cloudflare:sockets", () => ({
	connect: vi.fn(),
}))

describe("WorkerMailerPool 障害回復テスト", () => {
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
	const encode = (s: string) => new TextEncoder().encode(s)

	function createMockSocket(opened: Promise<void> = Promise.resolve()): MockSocket {
		const reader: MockReader = { read: vi.fn(), releaseLock: vi.fn() }
		const writer: MockWriter = { write: vi.fn(), releaseLock: vi.fn() }
		return {
			readable: { getReader: () => reader },
			writable: { getWriter: () => writer },
			opened,
			close: vi.fn(),
			startTls: vi.fn().mockReturnValue({
				readable: { getReader: () => reader },
				writable: { getWriter: () => writer },
			}),
		}
	}

	function setupConnectionMocks(socket: MockSocket): void {
		const reader = socket.readable.getReader()
		reader.read
			.mockResolvedValueOnce({ value: encode("220 smtp.example.com ready\r\n") })
			.mockResolvedValueOnce({
				value: encode("250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n"),
			})
			.mockResolvedValueOnce({ value: encode("235 Authentication successful\r\n") })
	}

	function setupSendMocks(socket: MockSocket): void {
		const reader = socket.readable.getReader()
		reader.read
			.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
			.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
			.mockResolvedValueOnce({ value: encode("354 Start mail input\r\n") })
			.mockResolvedValueOnce({ value: encode("250 Message accepted\r\n") })
	}

	const poolOptions = {
		host: "smtp.example.com",
		port: 587,
		username: "user",
		password: "pass",
		authType: ["plain"] as const,
	}

	const baseEmail = {
		from: "sender@example.com",
		to: "recipient@example.com",
		subject: "Test",
		text: "Hello",
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

	describe("接続失敗時の動作", () => {
		it("1つの接続が失敗するとconnect()全体がrejectする", async () => {
			let callCount = 0
			vi.mocked(connect).mockImplementation(() => {
				callCount++
				if (callCount === 2) {
					const failSocket = createMockSocket(
						new Promise<void>((_, reject) => setTimeout(() => reject(new Error("refused")), 0)),
					)
					failSocket.opened.catch(() => {})
					mockSockets.push(failSocket)
					return failSocket as unknown as ReturnType<typeof connect>
				}
				const socket = createMockSocket()
				setupConnectionMocks(socket)
				mockSockets.push(socket)
				return socket as unknown as ReturnType<typeof connect>
			})

			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 3 })
			await expect(pool.connect()).rejects.toThrow()
		})
	})

	describe("ping障害検出", () => {
		it("全接続がpingに成功するとtrueを返す", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 2 })
			await pool.connect()

			for (const socket of mockSockets) {
				const reader = socket.readable.getReader()
				reader.read.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
			}

			expect(await pool.ping()).toBe(true)
			await pool.close()
		})

		it("1つのping失敗でfalseを返す", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 2 })
			await pool.connect()

			const reader0 = mockSockets[0].readable.getReader()
			reader0.read.mockResolvedValueOnce({ value: encode("250 OK\r\n") })
			const reader1 = mockSockets[1].readable.getReader()
			reader1.read.mockResolvedValueOnce({ value: undefined, done: true })

			expect(await pool.ping()).toBe(false)
			await pool.close()
		})

		it("未接続プールのpingはfalseを返す", async () => {
			const pool = new WorkerMailerPool(poolOptions)
			expect(await pool.ping()).toBe(false)
		})
	})

	describe("close後の動作", () => {
		it("close後にsendするとSmtpConnectionErrorを投げる", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 2 })
			await pool.connect()
			await pool.close()

			await expect(pool.send(baseEmail)).rejects.toThrow(SmtpConnectionError)
		})

		it("close後にpingするとfalseを返す", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 2 })
			await pool.connect()
			await pool.close()

			expect(await pool.ping()).toBe(false)
		})
	})

	describe("送信中の障害", () => {
		it("送信先のmailerがエラーでも他のmailerは影響を受けない", async () => {
			const pool = new WorkerMailerPool({ ...poolOptions, poolSize: 2, maxRetries: 0 })
			await pool.connect()

			const reader0 = mockSockets[0].readable.getReader()
			reader0.read.mockResolvedValueOnce({ value: encode("451 Temporary failure\r\n") })
			reader0.read.mockResolvedValueOnce({ value: encode("250 RSET OK\r\n") })

			setupSendMocks(mockSockets[1])

			// Prevent Node.js UnhandledPromiseRejection for intentionally failing promise
			const result1 = pool.send(baseEmail)
			result1.catch(() => {})
			const result2 = pool.send(baseEmail)

			await expect(result1).rejects.toThrow()
			const sent = await result2
			expect(sent.response).toContain("Message accepted")

			await pool.close()
		})
	})
})

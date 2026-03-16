import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import { WorkerMailerError } from "../../src/errors"
import { SendCancelledError, WorkerMailer } from "../../src/mailer"

vi.mock("cloudflare:sockets", () => ({
	connect: vi.fn(),
}))

describe("SendHooks", () => {
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

	function setupSuccessfulSend() {
		mockReader.read
			.mockResolvedValueOnce({ value: encode("250 Sender OK\r\n") })
			.mockResolvedValueOnce({ value: encode("250 Recipient OK\r\n") })
			.mockResolvedValueOnce({ value: encode("354 Start mail input\r\n") })
			.mockResolvedValueOnce({ value: encode("250 Message accepted\r\n") })
	}

	const baseOptions = {
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

	describe("beforeSend", () => {
		it("called before sending", async () => {
			const beforeSend = vi.fn()
			setupConnection()
			setupSuccessfulSend()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend },
			})
			await mailer.send(baseEmail)
			expect(beforeSend).toHaveBeenCalledWith(baseEmail)
			await mailer.close()
		})

		it("false triggers SendCancelledError", async () => {
			const beforeSend = vi.fn().mockReturnValue(false)
			setupConnection()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend },
			})
			await expect(mailer.send(baseEmail)).rejects.toThrow(SendCancelledError)
			await mailer.close()
		})

		it("modified EmailOptions used for sending", async () => {
			const modified = { ...baseEmail, subject: "Modified Subject" }
			const beforeSend = vi.fn().mockReturnValue(modified)
			setupConnection()
			setupSuccessfulSend()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const afterSend = vi.fn()
			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend, afterSend },
			})
			await mailer.send(baseEmail)
			expect(afterSend).toHaveBeenCalledWith(
				modified,
				expect.objectContaining({ messageId: expect.stringContaining("@") }),
			)
			await mailer.close()
		})

		it("modified subject is sent over SMTP wire data", async () => {
			const modified = { ...baseEmail, subject: "Modified Subject" }
			const beforeSend = vi.fn().mockReturnValue(modified)
			setupConnection()
			setupSuccessfulSend()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend },
			})
			await mailer.send(baseEmail)

			const writeCalls = mockWriter.write.mock.calls
			const wireData = writeCalls
				.map((call: [Uint8Array]) => new TextDecoder().decode(call[0]))
				.join("")
			expect(wireData).toContain("Subject: Modified Subject")
			await mailer.close()
		})

		it("void proceeds with original options", async () => {
			const beforeSend = vi.fn().mockReturnValue(undefined)
			setupConnection()
			setupSuccessfulSend()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const afterSend = vi.fn()
			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend, afterSend },
			})
			await mailer.send(baseEmail)
			expect(afterSend).toHaveBeenCalledWith(
				baseEmail,
				expect.objectContaining({ accepted: ["recipient@example.com"] }),
			)
			await mailer.close()
		})

		it("throw causes rejection", async () => {
			const beforeSend = vi.fn().mockRejectedValue(new Error("Hook failed"))
			setupConnection()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend },
			})
			await expect(mailer.send(baseEmail)).rejects.toThrow("Hook failed")
			await mailer.close()
		})

		it("async hook is properly awaited", async () => {
			let resolved = false
			const beforeSend = vi.fn().mockImplementation(async () => {
				await new Promise<void>((r) => setTimeout(r, 20))
				resolved = true
			})
			setupConnection()
			setupSuccessfulSend()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend },
			})
			await mailer.send(baseEmail)
			expect(resolved).toBe(true)
			await mailer.close()
		})

		it("returning object missing 'from' still gets used as emailOptions", async () => {
			const beforeSend = vi.fn().mockReturnValue({ subject: "No From" })
			setupConnection()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend },
			})
			await expect(mailer.send(baseEmail)).rejects.toThrow()
			await mailer.close()
		})

		it("returning empty object causes validation error", async () => {
			const beforeSend = vi.fn().mockReturnValue({})
			setupConnection()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend },
			})
			await expect(mailer.send(baseEmail)).rejects.toThrow()
			await mailer.close()
		})
	})

	describe("afterSend", () => {
		it("called after successful send", async () => {
			const afterSend = vi.fn()
			setupConnection()
			setupSuccessfulSend()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { afterSend },
			})
			await mailer.send(baseEmail)
			expect(afterSend).toHaveBeenCalledOnce()
			await mailer.close()
		})

		it("receives correct EmailOptions and SendResult", async () => {
			const afterSend = vi.fn()
			setupConnection()
			setupSuccessfulSend()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { afterSend },
			})
			const result = await mailer.send(baseEmail)
			expect(afterSend).toHaveBeenCalledWith(baseEmail, result)
			await mailer.close()
		})

		it("throw does not affect send result", async () => {
			const afterSend = vi.fn().mockRejectedValue(new Error("Hook error"))
			setupConnection()
			setupSuccessfulSend()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { afterSend },
			})
			const result = await mailer.send(baseEmail)
			expect(result.accepted).toContain("recipient@example.com")
			await mailer.close()
		})
	})

	describe("onSendError", () => {
		it("called on send failure", async () => {
			const onSendError = vi.fn()
			setupConnection()
			mockReader.read
				.mockResolvedValueOnce({ value: encode("451 Temporary failure\r\n") })
				.mockResolvedValueOnce({ value: encode("250 RSET OK\r\n") })
				.mockResolvedValueOnce({ value: encode("451 Temporary failure\r\n") })
				.mockResolvedValueOnce({ value: encode("250 RSET OK\r\n") })
				.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				maxRetries: 1,
				hooks: { onSendError },
			})

			await expect(mailer.send(baseEmail)).rejects.toThrow()
			await new Promise<void>((r) => setTimeout(r, 50))
			expect(onSendError).toHaveBeenCalledWith(
				baseEmail,
				expect.objectContaining({
					message: expect.stringContaining("max retries"),
				}),
			)
			await mailer.close()
		})

		it("throw inside onSendError does not replace original rejection", async () => {
			const onSendError = vi.fn().mockRejectedValue(new Error("hook crash"))
			setupConnection()
			mockReader.read
				.mockResolvedValueOnce({ value: encode("451 Temporary failure\r\n") })
				.mockResolvedValueOnce({ value: encode("250 RSET OK\r\n") })
				.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				maxRetries: 0,
				hooks: { onSendError },
			})

			await expect(mailer.send(baseEmail)).rejects.toThrow(/max retries/)
			await new Promise<void>((r) => setTimeout(r, 50))
			expect(onSendError).toHaveBeenCalled()
			await mailer.close()
		})
	})

	describe("lifecycle hooks", () => {
		it("onConnected called after successful connection", async () => {
			const onConnected = vi.fn()
			setupConnection()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { onConnected },
			})
			expect(onConnected).toHaveBeenCalledWith({
				host: "smtp.example.com",
				port: 587,
			})
			await mailer.close()
		})

		it("onConnected receives host and port only", async () => {
			const onConnected = vi.fn()
			setupConnection()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { onConnected },
			})
			const arg = onConnected.mock.calls[0][0] as { host: string; port: number }
			expect(arg).toHaveProperty("host")
			expect(arg).toHaveProperty("port")
			expect(typeof arg.host).toBe("string")
			expect(typeof arg.port).toBe("number")
			await mailer.close()
		})

		it("onConnected called exactly once", async () => {
			const onConnected = vi.fn()
			setupConnection()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { onConnected },
			})
			expect(onConnected).toHaveBeenCalledTimes(1)
			await mailer.close()
		})

		it("onDisconnected called on close()", async () => {
			const onDisconnected = vi.fn()
			setupConnection()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { onDisconnected },
			})
			await mailer.close()
			expect(onDisconnected).toHaveBeenCalledWith({ reason: undefined })
		})

		it("onDisconnected called exactly once on close()", async () => {
			const onDisconnected = vi.fn()
			setupConnection()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { onDisconnected },
			})
			await mailer.close()
			expect(onDisconnected).toHaveBeenCalledTimes(1)
		})

		it("onDisconnected receives reason on error close", async () => {
			const onDisconnected = vi.fn()
			const onFatalError = vi.fn()
			setupConnection()

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				maxRetries: 0,
				hooks: { onDisconnected, onFatalError },
			})

			mockReader.read
				.mockResolvedValueOnce({ value: encode("451 Temporary failure\r\n") })
				.mockResolvedValueOnce({ value: encode("500 RSET failed\r\n") })

			const sendPromise = mailer.send(baseEmail)
			await expect(sendPromise).rejects.toThrow()
			await new Promise<void>((r) => setTimeout(r, 50))
			expect(onDisconnected).toHaveBeenCalledWith(
				expect.objectContaining({
					reason: expect.stringContaining("RSET failed"),
				}),
			)
		})

		it("onFatalError called on fatal error", async () => {
			const onFatalError = vi.fn()
			setupConnection()

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				maxRetries: 0,
				hooks: { onFatalError },
			})

			mockReader.read
				.mockResolvedValueOnce({ value: encode("451 Temporary failure\r\n") })
				.mockResolvedValueOnce({ value: encode("500 RSET failed\r\n") })

			const sendPromise = mailer.send(baseEmail)
			await expect(sendPromise).rejects.toThrow()
			await new Promise<void>((r) => setTimeout(r, 50))
			expect(onFatalError).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining("RSET failed"),
				}),
			)
		})

		it("onFatalError receives an Error instance", async () => {
			const onFatalError = vi.fn()
			setupConnection()

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				maxRetries: 0,
				hooks: { onFatalError },
			})

			mockReader.read
				.mockResolvedValueOnce({ value: encode("451 Temporary failure\r\n") })
				.mockResolvedValueOnce({ value: encode("500 RSET failed\r\n") })

			const sendPromise = mailer.send(baseEmail)
			await expect(sendPromise).rejects.toThrow()
			await new Promise<void>((r) => setTimeout(r, 50))
			expect(onFatalError.mock.calls[0][0]).toBeInstanceOf(Error)
		})
	})

	describe("combined hooks", () => {
		it("success: beforeSend+afterSend called, onSendError not called", async () => {
			const beforeSend = vi.fn()
			const afterSend = vi.fn()
			const onSendError = vi.fn()
			setupConnection()
			setupSuccessfulSend()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend, afterSend, onSendError },
			})
			await mailer.send(baseEmail)
			await new Promise<void>((r) => setTimeout(r, 50))

			expect(beforeSend).toHaveBeenCalledOnce()
			expect(afterSend).toHaveBeenCalledOnce()
			expect(onSendError).not.toHaveBeenCalled()
			await mailer.close()
		})

		it("failure: beforeSend+onSendError called, afterSend not called", async () => {
			const beforeSend = vi.fn()
			const afterSend = vi.fn()
			const onSendError = vi.fn()
			setupConnection()
			mockReader.read
				.mockResolvedValueOnce({ value: encode("451 Temporary failure\r\n") })
				.mockResolvedValueOnce({ value: encode("250 RSET OK\r\n") })
				.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				maxRetries: 0,
				hooks: { beforeSend, afterSend, onSendError },
			})
			await expect(mailer.send(baseEmail)).rejects.toThrow()
			await new Promise<void>((r) => setTimeout(r, 50))

			expect(beforeSend).toHaveBeenCalledOnce()
			expect(afterSend).not.toHaveBeenCalled()
			expect(onSendError).toHaveBeenCalledOnce()
			await mailer.close()
		})
	})

	describe("async hook timeline", () => {
		it("async beforeSend completes before afterSend fires", async () => {
			const timeline: string[] = []
			const beforeSend = vi.fn().mockImplementation(async () => {
				timeline.push("hook-start")
				await new Promise<void>((r) => setTimeout(r, 30))
				timeline.push("hook-end")
			})
			const afterSend = vi.fn().mockImplementation(() => {
				timeline.push("afterSend")
			})
			setupConnection()
			setupSuccessfulSend()
			mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

			const mailer = await WorkerMailer.connect({
				...baseOptions,
				hooks: { beforeSend, afterSend },
			})
			await mailer.send(baseEmail)
			await new Promise<void>((r) => setTimeout(r, 50))

			const hookEndIdx = timeline.indexOf("hook-end")
			const afterSendIdx = timeline.indexOf("afterSend")
			expect(hookEndIdx).toBeLessThan(afterSendIdx)
			await mailer.close()
		})
	})

	it("executes hooks in correct order: beforeSend → send → afterSend", async () => {
		const order: string[] = []
		const beforeSend = vi.fn().mockImplementation(() => {
			order.push("beforeSend")
		})
		const afterSend = vi.fn().mockImplementation(() => {
			order.push("afterSend")
		})
		setupConnection()
		setupSuccessfulSend()
		mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

		const mailer = await WorkerMailer.connect({
			...baseOptions,
			hooks: { beforeSend, afterSend },
		})
		await mailer.send(baseEmail)
		await new Promise<void>((r) => setTimeout(r, 100))

		expect(order).toEqual(["beforeSend", "afterSend"])
		await mailer.close()
	})

	it("works correctly with no hooks configured", async () => {
		setupConnection()
		setupSuccessfulSend()
		mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

		const mailer = await WorkerMailer.connect(baseOptions)
		const result = await mailer.send(baseEmail)
		expect(result.accepted).toContain("recipient@example.com")
		await mailer.close()
	})

	it("SendCancelledError has correct name property", () => {
		const error = new SendCancelledError()
		expect(error.name).toBe("SendCancelledError")
		expect(error.message).toBe("Send cancelled by beforeSend hook")
		expect(error).toBeInstanceOf(Error)
	})

	it("SendCancelledError extends WorkerMailerError", () => {
		const error = new SendCancelledError()
		expect(error).toBeInstanceOf(WorkerMailerError)
	})

	it("beforeSend called for each email in sequence", async () => {
		const calls: string[] = []
		const beforeSend = vi.fn().mockImplementation((email: { subject: string }) => {
			calls.push(email.subject)
		})
		setupConnection()
		setupSuccessfulSend()
		setupSuccessfulSend()
		mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

		const mailer = await WorkerMailer.connect({
			...baseOptions,
			hooks: { beforeSend },
		})
		await mailer.send({ ...baseEmail, subject: "First" })
		await mailer.send({ ...baseEmail, subject: "Second" })
		expect(calls).toEqual(["First", "Second"])
		await mailer.close()
	})

	it("afterSend receives fresh result for each send", async () => {
		const results: string[] = []
		const afterSend = vi
			.fn()
			.mockImplementation((_email: unknown, result: { messageId: string }) => {
				results.push(result.messageId)
			})
		setupConnection()
		setupSuccessfulSend()
		setupSuccessfulSend()
		mockReader.read.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

		const mailer = await WorkerMailer.connect({
			...baseOptions,
			hooks: { afterSend },
		})
		await mailer.send(baseEmail)
		await mailer.send(baseEmail)
		await new Promise<void>((r) => setTimeout(r, 50))
		expect(results).toHaveLength(2)
		expect(results[0]).not.toBe(results[1])
		await mailer.close()
	})

	it("onSendError receives original email options", async () => {
		const onSendError = vi.fn()
		setupConnection()
		mockReader.read
			.mockResolvedValueOnce({ value: encode("451 Temporary failure\r\n") })
			.mockResolvedValueOnce({ value: encode("250 RSET OK\r\n") })
			.mockResolvedValueOnce({ value: encode("221 Bye\r\n") })

		const mailer = await WorkerMailer.connect({
			...baseOptions,
			maxRetries: 0,
			hooks: { onSendError },
		})
		const email = { ...baseEmail, subject: "Track This" }
		await expect(mailer.send(email)).rejects.toThrow()
		await new Promise<void>((r) => setTimeout(r, 50))
		expect(onSendError).toHaveBeenCalledWith(
			expect.objectContaining({ subject: "Track This" }),
			expect.any(Error),
		)
		await mailer.close()
	})

	it("falls back to console.error when onFatalError not set", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		setupConnection()

		const mailer = await WorkerMailer.connect({
			...baseOptions,
			maxRetries: 0,
		})

		mockReader.read
			.mockResolvedValueOnce({ value: encode("451 Temporary failure\r\n") })
			.mockResolvedValueOnce({ value: encode("500 RSET failed\r\n") })

		const sendPromise = mailer.send(baseEmail)
		await expect(sendPromise).rejects.toThrow()
		await new Promise<void>((r) => setTimeout(r, 50))
		expect(consoleSpy).toHaveBeenCalled()
		consoleSpy.mockRestore()
	})
})

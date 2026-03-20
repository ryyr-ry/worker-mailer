import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Logger, { LogLevel } from "../../src/logger"

describe("Logger", () => {
	let spies: Record<string, ReturnType<typeof vi.spyOn>>

	beforeEach(() => {
		spies = {
			debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
			info: vi.spyOn(console, "info").mockImplementation(() => {}),
			warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
			error: vi.spyOn(console, "error").mockImplementation(() => {}),
		}
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("DEBUG level logs all severity levels", () => {
		const logger = new Logger(LogLevel.DEBUG, "[T]")
		logger.debug("d")
		logger.info("i")
		logger.warn("w")
		logger.error("e")
		expect(spies.debug).toHaveBeenCalledTimes(1)
		expect(spies.info).toHaveBeenCalledTimes(1)
		expect(spies.warn).toHaveBeenCalledTimes(1)
		expect(spies.error).toHaveBeenCalledTimes(1)
	})

	it("ERROR level suppresses debug, info, and warn", () => {
		const logger = new Logger(LogLevel.ERROR, "[T]")
		logger.debug("d")
		logger.info("i")
		logger.warn("w")
		logger.error("e")
		expect(spies.debug).not.toHaveBeenCalled()
		expect(spies.info).not.toHaveBeenCalled()
		expect(spies.warn).not.toHaveBeenCalled()
		expect(spies.error).toHaveBeenCalledTimes(1)
	})

	it("NONE level suppresses all output", () => {
		const logger = new Logger(LogLevel.NONE, "[T]")
		logger.debug("d")
		logger.info("i")
		logger.warn("w")
		logger.error("e")
		expect(spies.debug).not.toHaveBeenCalled()
		expect(spies.info).not.toHaveBeenCalled()
		expect(spies.warn).not.toHaveBeenCalled()
		expect(spies.error).not.toHaveBeenCalled()
	})

	describe("Credential leak prevention (Security Section 5)", () => {
		it("AUTH PLAIN credentials are redacted from log output", () => {
			const logger = new Logger(LogLevel.DEBUG, "[SMTP]")
			logger.debug("AUTH PLAIN dXNlcjpwYXNz")
			const msg = spies.debug.mock.calls[0][0] as string
			expect(msg).toContain("[REDACTED]")
			expect(msg).not.toContain("dXNlcjpwYXNz")
		})

		it("long base64 tokens are redacted from log output", () => {
			const logger = new Logger(LogLevel.DEBUG, "[SMTP]")
			const token = "A".repeat(100)
			logger.debug(`token: ${token}`)
			const msg = spies.debug.mock.calls[0][0] as string
			expect(msg).toContain("[REDACTED]")
			expect(msg).not.toContain(token)
		})

		it("standalone base64 on its own line (AUTH LOGIN flow) is redacted", () => {
			const logger = new Logger(LogLevel.DEBUG, "[SMTP]")
			logger.debug("Write to socket:\ndXNlcm5hbWU=\r\n")
			const msg = spies.debug.mock.calls[0][0] as string
			expect(msg).toContain("[REDACTED]")
			expect(msg).not.toContain("dXNlcm5hbWU=")
		})

		it("standalone base64 at start of message is redacted", () => {
			const logger = new Logger(LogLevel.DEBUG, "[SMTP]")
			logger.debug("dXNlcm5hbWU=\r\nmore data")
			const msg = spies.debug.mock.calls[0][0] as string
			expect(msg).toContain("[REDACTED]")
			expect(msg).not.toContain("dXNlcm5hbWU=")
		})

		it("short base64 password (4 chars) is redacted from AUTH LOGIN flow", () => {
			const logger = new Logger(LogLevel.DEBUG, "[SMTP]")
			logger.debug("Write to socket:\nYm9i\r\n")
			const msg = spies.debug.mock.calls[0][0] as string
			expect(msg).toContain("[REDACTED]")
			expect(msg).not.toContain("Ym9i")
		})
	})

	describe("Logger args sanitization", () => {
		it("string args have credentials redacted", () => {
			const logger = new Logger(LogLevel.DEBUG, "[SMTP]")
			logger.debug("test", "AUTH PLAIN dXNlcjpwYXNz")
			const args = spies.debug.mock.calls[0].slice(1) as string[]
			expect(args[0]).toContain("[REDACTED]")
			expect(args[0]).not.toContain("dXNlcjpwYXNz")
		})

		it("non-string args are passed through unchanged", () => {
			const logger = new Logger(LogLevel.DEBUG, "[SMTP]")
			const obj = { key: "value" }
			logger.debug("test", obj)
			const args = spies.debug.mock.calls[0].slice(1) as unknown[]
			expect(args[0]).toBe(obj)
		})

		it("long base64 in string args is redacted", () => {
			const logger = new Logger(LogLevel.DEBUG, "[SMTP]")
			const longB64 = "A".repeat(100)
			logger.debug("test", `data: ${longB64}`)
			const args = spies.debug.mock.calls[0].slice(1) as string[]
			expect(args[0]).toContain("[REDACTED]")
		})
	})
})

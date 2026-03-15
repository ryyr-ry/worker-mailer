import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Logger, { LogLevel } from "../../src/logger"

describe("Logger", () => {
	let consoleSpy: {
		debug: ReturnType<typeof vi.spyOn>
		info: ReturnType<typeof vi.spyOn>
		warn: ReturnType<typeof vi.spyOn>
		error: ReturnType<typeof vi.spyOn>
	}

	beforeEach(() => {
		// Mock console methods
		consoleSpy = {
			debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
			info: vi.spyOn(console, "info").mockImplementation(() => {}),
			warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
			error: vi.spyOn(console, "error").mockImplementation(() => {}),
		}
	})

	afterEach(() => {
		// Clear all mocks
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should create logger with default level INFO", () => {
			const logger = new Logger(undefined, "[Test]")
			expect(logger).toBeInstanceOf(Logger)
		})

		it("should create logger with specified level", () => {
			const logger = new Logger(LogLevel.DEBUG, "[Test]")
			expect(logger).toBeInstanceOf(Logger)
		})
	})

	describe("logging methods", () => {
		it("should log debug messages when level is DEBUG", () => {
			const logger = new Logger(LogLevel.DEBUG, "[Test]")
			logger.debug("debug message")
			expect(consoleSpy.debug).toHaveBeenCalledWith(expect.stringContaining("[Test] debug message"))
		})

		it("should not log debug messages when level is INFO", () => {
			const logger = new Logger(LogLevel.INFO, "[Test]")
			logger.debug("debug message")
			expect(consoleSpy.debug).not.toHaveBeenCalled()
		})

		it("should log info messages when level is INFO", () => {
			const logger = new Logger(LogLevel.INFO, "[Test]")
			logger.info("info message")
			expect(consoleSpy.info).toHaveBeenCalledWith(expect.stringContaining("[Test] info message"))
		})

		it("should not log info messages when level is WARN", () => {
			const logger = new Logger(LogLevel.WARN, "[Test]")
			logger.info("info message")
			expect(consoleSpy.info).not.toHaveBeenCalled()
		})

		it("should log warn messages when level is WARN", () => {
			const logger = new Logger(LogLevel.WARN, "[Test]")
			logger.warn("warn message")
			expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining("[Test] warn message"))
		})

		it("should not log warn messages when level is ERROR", () => {
			const logger = new Logger(LogLevel.ERROR, "[Test]")
			logger.warn("warn message")
			expect(consoleSpy.warn).not.toHaveBeenCalled()
		})

		it("should log error messages when level is ERROR", () => {
			const logger = new Logger(LogLevel.ERROR, "[Test]")
			logger.error("error message")
			expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("[Test] error message"))
		})

		it("should not log any messages when level is NONE", () => {
			const logger = new Logger(LogLevel.NONE, "[Test]")
			logger.debug("debug message")
			logger.info("info message")
			logger.warn("warn message")
			logger.error("error message")
			expect(consoleSpy.debug).not.toHaveBeenCalled()
			expect(consoleSpy.info).not.toHaveBeenCalled()
			expect(consoleSpy.warn).not.toHaveBeenCalled()
			expect(consoleSpy.error).not.toHaveBeenCalled()
		})
	})

	describe("log formatting", () => {
		it("should format message with additional arguments", () => {
			const logger = new Logger(LogLevel.INFO, "[Test]")
			logger.info("message with %s", "argument")
			expect(consoleSpy.info).toHaveBeenCalledWith(
				expect.stringContaining("[Test] message with %s"),
				"argument",
			)
		})

		it("should handle multiple arguments", () => {
			const logger = new Logger(LogLevel.INFO, "[Test]")
			logger.info("message with %s and %d", "string", 42)
			expect(consoleSpy.info).toHaveBeenCalledWith(
				expect.stringContaining("[Test] message with %s and %d"),
				"string",
				42,
			)
		})

		it("should handle objects in arguments", () => {
			const logger = new Logger(LogLevel.INFO, "[Test]")
			const obj = { key: "value" }
			logger.info("message with object:", obj)
			expect(consoleSpy.info).toHaveBeenCalledWith(
				expect.stringContaining("[Test] message with object:"),
				obj,
			)
		})

		it("should include ISO timestamp in log output", () => {
			const logger = new Logger(LogLevel.INFO, "[Test]")
			logger.info("timestamp test")
			const loggedMessage = consoleSpy.info.mock.calls[0][0] as string
			expect(loggedMessage).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
		})
	})
})

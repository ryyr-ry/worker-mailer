import { describe, expect, it, vi } from "vitest"
import { authenticate } from "../../src/mailer/auth"
import { SmtpAuthError } from "../../src/errors"
import type { SmtpCapabilities } from "../../src/mailer/types"
import Logger from "../../src/logger"

function createMockTransport() {
	return {
		writeLine: vi.fn().mockResolvedValue(undefined),
		readTimeout: vi.fn(),
		write: vi.fn(),
		read: vi.fn(),
		upgradeTls: vi.fn(),
		quit: vi.fn(),
		safeClose: vi.fn(),
		waitForOpen: vi.fn(),
	}
}

function createCapabilities(overrides: Partial<SmtpCapabilities> = {}): SmtpCapabilities {
	return {
		supportsDSN: false,
		allowAuth: true,
		authTypeSupported: ["plain", "login"],
		supportsStartTls: false,
		...overrides,
	}
}

const logger = new Logger("NONE", "[test]")

describe("authenticate", () => {
	describe("PLAIN認証", () => {
		it("正常にPLAIN認証が成功する", async () => {
			const transport = createMockTransport()
			transport.readTimeout.mockResolvedValueOnce("235 Authentication successful\r\n")
			await authenticate({
				transport: transport as never,
				credentials: { username: "user", password: "pass" },
				capabilities: createCapabilities({ authTypeSupported: ["plain"] }),
				preferredTypes: ["plain"],
				logger,
			})
			expect(transport.writeLine).toHaveBeenCalledWith(expect.stringContaining("AUTH PLAIN"))
		})

		it("PLAIN認証失敗時にSmtpAuthErrorを投げる", async () => {
			const transport = createMockTransport()
			transport.readTimeout.mockResolvedValueOnce("535 Authentication failed\r\n")
			await expect(
				authenticate({
					transport: transport as never,
					credentials: { username: "user", password: "pass" },
					capabilities: createCapabilities({ authTypeSupported: ["plain"] }),
					preferredTypes: ["plain"],
					logger,
				}),
			).rejects.toThrow(SmtpAuthError)
		})
	})

	describe("LOGIN認証", () => {
		it("正常にLOGIN認証が成功する", async () => {
			const transport = createMockTransport()
			transport.readTimeout
				.mockResolvedValueOnce("334 VXNlcm5hbWU6\r\n")
				.mockResolvedValueOnce("334 UGFzc3dvcmQ6\r\n")
				.mockResolvedValueOnce("235 Authentication successful\r\n")
			await authenticate({
				transport: transport as never,
				credentials: { username: "user", password: "pass" },
				capabilities: createCapabilities({ authTypeSupported: ["login"] }),
				preferredTypes: ["login"],
				logger,
			})
			expect(transport.writeLine).toHaveBeenCalledWith("AUTH LOGIN")
		})

		it("LOGIN認証のユーザー名ステップで失敗", async () => {
			const transport = createMockTransport()
			transport.readTimeout.mockResolvedValueOnce("535 Authentication failed\r\n")
			await expect(
				authenticate({
					transport: transport as never,
					credentials: { username: "user", password: "pass" },
					capabilities: createCapabilities({ authTypeSupported: ["login"] }),
					preferredTypes: ["login"],
					logger,
				}),
			).rejects.toThrow(SmtpAuthError)
		})

		it("LOGIN認証のパスワードステップで失敗", async () => {
			const transport = createMockTransport()
			transport.readTimeout
				.mockResolvedValueOnce("334 VXNlcm5hbWU6\r\n")
				.mockResolvedValueOnce("334 UGFzc3dvcmQ6\r\n")
				.mockResolvedValueOnce("535 Authentication failed\r\n")
			await expect(
				authenticate({
					transport: transport as never,
					credentials: { username: "user", password: "pass" },
					capabilities: createCapabilities({ authTypeSupported: ["login"] }),
					preferredTypes: ["login"],
					logger,
				}),
			).rejects.toThrow(SmtpAuthError)
		})
	})

	describe("CRAM-MD5認証", () => {
		// HMAC-MD5はCloudflare Workers環境でのみサポート（Vitest/Node環境では非サポート）
		it.skip("正常にCRAM-MD5認証が成功する", async () => {
			const challenge = btoa("test-challenge-string")
			const transport = createMockTransport()
			transport.readTimeout
				.mockResolvedValueOnce(`334 ${challenge}\r\n`)
				.mockResolvedValueOnce("235 Authentication successful\r\n")
			await authenticate({
				transport: transport as never,
				credentials: { username: "user", password: "pass" },
				capabilities: createCapabilities({ authTypeSupported: ["cram-md5"] }),
				preferredTypes: ["cram-md5"],
				logger,
			})
			expect(transport.writeLine).toHaveBeenCalledWith("AUTH CRAM-MD5")
		})

		it("CRAM-MD5のチャレンジが無効な場合にエラー", async () => {
			const transport = createMockTransport()
			transport.readTimeout.mockResolvedValueOnce("535 No challenge\r\n")
			await expect(
				authenticate({
					transport: transport as never,
					credentials: { username: "user", password: "pass" },
					capabilities: createCapabilities({ authTypeSupported: ["cram-md5"] }),
					preferredTypes: ["cram-md5"],
					logger,
				}),
			).rejects.toThrow(SmtpAuthError)
		})
	})

	describe("認証方式の選択", () => {
		it("サポートされた認証方式がない場合にSmtpAuthErrorを投げる", async () => {
			const transport = createMockTransport()
			await expect(
				authenticate({
					transport: transport as never,
					credentials: { username: "user", password: "pass" },
					capabilities: createCapabilities({ authTypeSupported: ["plain"] }),
					preferredTypes: ["cram-md5"],
					logger,
				}),
			).rejects.toThrow("No supported authentication method found")
		})

		it("allowAuth: falseの場合は認証をスキップする", async () => {
			const transport = createMockTransport()
			await authenticate({
				transport: transport as never,
				credentials: { username: "user", password: "pass" },
				capabilities: createCapabilities({ allowAuth: false }),
				preferredTypes: ["plain"],
				logger,
			})
			expect(transport.writeLine).not.toHaveBeenCalled()
		})

		it("PLAINとLOGIN両方サポート時はPLAINを優先する", async () => {
			const transport = createMockTransport()
			transport.readTimeout.mockResolvedValueOnce("235 OK\r\n")
			await authenticate({
				transport: transport as never,
				credentials: { username: "user", password: "pass" },
				capabilities: createCapabilities({ authTypeSupported: ["plain", "login"] }),
				preferredTypes: ["plain", "login"],
				logger,
			})
			expect(transport.writeLine).toHaveBeenCalledWith(expect.stringContaining("AUTH PLAIN"))
		})
	})

	describe("UTF-8認証情報", () => {
		it("日本語ユーザー名でPLAIN認証が動作する", async () => {
			const transport = createMockTransport()
			transport.readTimeout.mockResolvedValueOnce("235 OK\r\n")
			await authenticate({
				transport: transport as never,
				credentials: { username: "テスト@example.com", password: "パスワード" },
				capabilities: createCapabilities({ authTypeSupported: ["plain"] }),
				preferredTypes: ["plain"],
				logger,
			})
			expect(transport.writeLine).toHaveBeenCalledWith(expect.stringContaining("AUTH PLAIN"))
		})
	})
})

import { describe, expect, it, vi } from "vitest"
import { SmtpTransport } from "../../src/mailer/transport"
import { CrlfInjectionError, SmtpConnectionError } from "../../src/errors"
import Logger from "../../src/logger"

const logger = new Logger("NONE", "[test]")

function createMockSocket(readResults: Array<{ value?: Uint8Array; done?: boolean }>) {
	let readIndex = 0
	const reader = {
		read: vi.fn().mockImplementation(() => {
			if (readIndex < readResults.length) {
				return Promise.resolve(readResults[readIndex++])
			}
			return Promise.resolve({ done: true })
		}),
		releaseLock: vi.fn(),
	}
	const writer = {
		write: vi.fn().mockResolvedValue(undefined),
		releaseLock: vi.fn(),
	}
	const socket = {
		readable: { getReader: () => reader },
		writable: { getWriter: () => writer },
		opened: Promise.resolve(),
		close: vi.fn().mockResolvedValue(undefined),
		startTls: vi.fn().mockReturnValue({
			readable: { getReader: () => reader },
			writable: { getWriter: () => writer },
		}),
	}
	return { socket, reader, writer }
}

const enc = (s: string) => new TextEncoder().encode(s)

describe("SmtpTransport", () => {
	describe("read - フラグメンテーション処理", () => {
		it("複数チャンクに分割されたレスポンスを正しく結合する", async () => {
			const { socket } = createMockSocket([
				{ value: enc("250-smtp.example.com\r\n") },
				{ value: enc("250 OK\r\n") },
			])
			const transport = new SmtpTransport(socket as never, logger, 5000)
			const result = await transport.read()
			expect(result).toBe("250-smtp.example.com\r\n250 OK\r\n")
		})

		it("改行なしで途中まで届いたデータを待機して結合する", async () => {
			const { socket } = createMockSocket([
				{ value: enc("250-smtp") },
				{ value: enc(".example.com\r\n250 OK\r\n") },
			])
			const transport = new SmtpTransport(socket as never, logger, 5000)
			const result = await transport.read()
			expect(result).toBe("250-smtp.example.com\r\n250 OK\r\n")
		})

		it("マルチラインレスポンス（250-）を完全に読み取る", async () => {
			const { socket } = createMockSocket([
				{ value: enc("250-AUTH PLAIN LOGIN\r\n250-DSN\r\n250 STARTTLS\r\n") },
			])
			const transport = new SmtpTransport(socket as never, logger, 5000)
			const result = await transport.read()
			expect(result).toContain("250-AUTH")
			expect(result).toContain("250 STARTTLS")
		})

		it("接続が閉じられた場合にSmtpConnectionErrorを投げる", async () => {
			const { socket } = createMockSocket([{ done: true }])
			const transport = new SmtpTransport(socket as never, logger, 5000)
			await expect(transport.read()).rejects.toThrow(SmtpConnectionError)
		})
	})

	describe("writeLine - CRLFインジェクション防止", () => {
		it("CRを含むコマンドを拒否する", async () => {
			const { socket } = createMockSocket([])
			const transport = new SmtpTransport(socket as never, logger, 5000)
			await expect(transport.writeLine("MAIL FROM:<a\r>")).rejects.toThrow(CrlfInjectionError)
		})

		it("LFを含むコマンドを拒否する", async () => {
			const { socket } = createMockSocket([])
			const transport = new SmtpTransport(socket as never, logger, 5000)
			await expect(transport.writeLine("RCPT TO:<a\n>")).rejects.toThrow(CrlfInjectionError)
		})

		it("正常なコマンドにCRLFを付与して送信する", async () => {
			const { socket, writer } = createMockSocket([])
			const transport = new SmtpTransport(socket as never, logger, 5000)
			await transport.writeLine("EHLO example.com")
			expect(writer.write).toHaveBeenCalledWith(enc("EHLO example.com\r\n"))
		})
	})

	describe("upgradeTls", () => {
		it("TLSアップグレード後にリーダー/ライターを再取得する", () => {
			const { socket } = createMockSocket([])
			const transport = new SmtpTransport(socket as never, logger, 5000)
			transport.upgradeTls()
			expect(socket.startTls).toHaveBeenCalled()
		})
	})

	describe("readTimeout", () => {
		it("タイムアウト内にレスポンスが返れば成功する", async () => {
			const { socket } = createMockSocket([{ value: enc("250 OK\r\n") }])
			const transport = new SmtpTransport(socket as never, logger, 5000)
			const result = await transport.readTimeout()
			expect(result).toBe("250 OK\r\n")
		})

		it("タイムアウト時にSmtpConnectionErrorを投げる", async () => {
			const { socket, reader } = createMockSocket([])
			reader.read.mockImplementation(() => new Promise(() => {}))
			const transport = new SmtpTransport(socket as never, logger, 50)
			await expect(transport.readTimeout()).rejects.toThrow(SmtpConnectionError)
		})
	})
})

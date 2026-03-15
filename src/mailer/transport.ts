import type Logger from "../logger"
import { decode, encode, execTimeout } from "../utils"

export class SmtpTransport {
	private reader: ReadableStreamDefaultReader<Uint8Array>
	private writer: WritableStreamDefaultWriter<Uint8Array>
	private socket: Socket
	private readonly logger: Logger
	private readonly responseTimeoutMs: number

	constructor(socket: Socket, logger: Logger, responseTimeoutMs: number) {
		this.socket = socket
		this.reader = socket.readable.getReader()
		this.writer = socket.writable.getWriter()
		this.logger = logger
		this.responseTimeoutMs = responseTimeoutMs
	}

	async read(): Promise<string> {
		let response = ""
		while (true) {
			const { value, done } = await this.reader.read()
			if (done) {
				throw new Error(
					"[WorkerMailer] Connection closed: SMTP server closed the connection unexpectedly",
				)
			}
			if (!value) {
				continue
			}
			const data = decode(value)
			this.logger.debug(`SMTP server response:\n${data}`)
			response = response + data
			if (!response.endsWith("\n")) {
				continue
			}
			const lines = response.split(/\r?\n/)
			const lastLine = lines[lines.length - 2]
			if (/^\d+-/.test(lastLine)) {
				continue
			}
			return response
		}
	}

	async readTimeout(): Promise<string> {
		return execTimeout(
			this.read(),
			this.responseTimeoutMs,
			new Error("[WorkerMailer] Connection timeout: waiting for SMTP server response"),
		)
	}

	async write(data: string): Promise<void> {
		this.logger.debug(`Write to socket:\n${data}`)
		await this.writer.write(encode(data))
	}

	async writeLine(line: string): Promise<void> {
		if (/[\r\n]/.test(line)) {
			throw new Error("[WorkerMailer] Security error: CRLF injection detected in SMTP command")
		}
		await this.write(`${line}\r\n`)
	}

	upgradeTls(): void {
		this.reader.releaseLock()
		this.writer.releaseLock()
		this.socket = this.socket.startTls()
		this.reader = this.socket.readable.getReader()
		this.writer = this.socket.writable.getWriter()
	}

	async quit(): Promise<void> {
		await this.writeLine("QUIT")
		await this.readTimeout()
		this.socket.close().catch(() => this.logger.error("[WorkerMailer] Failed to close socket"))
	}

	safeClose(): void {
		try {
			this.reader.releaseLock()
		} catch (_) {
			/* すでにリリース済みの場合 */
		}
		try {
			this.writer.releaseLock()
		} catch (_) {
			/* すでにリリース済みの場合 */
		}
		try {
			this.socket
				.close()
				.catch(() => this.logger.error("[WorkerMailer] Failed to close socket during reconnect"))
		} catch (_) {
			/* ソケットが既に閉じている場合 */
		}
	}

	async waitForOpen(timeoutMs: number): Promise<void> {
		await execTimeout(
			this.socket.opened,
			timeoutMs,
			new Error("[WorkerMailer] Connection timeout: socket connection timed out"),
		)
	}
}

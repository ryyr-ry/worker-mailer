import { connect } from "cloudflare:sockets"
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import type { MailPlugin, SendHooks } from "../../src/mailer"
import { WorkerMailer } from "../../src/mailer"
import { type TelemetryEvent, telemetryPlugin } from "../../src/plugins"

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }))
vi.mock("../../src/utils", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../../src/utils")>()
	return { ...mod, backoff: () => Promise.resolve() }
})

const encode = (value: string) => new TextEncoder().encode(value)
const GREETING = "220 ready\r\n"
const EHLO_STARTTLS = "250-test\r\n250-STARTTLS\r\n250-AUTH PLAIN\r\n250 OK\r\n"
const TLS_OK = "220 Ready to start TLS\r\n"
const EHLO_AUTH = "250-test\r\n250-AUTH PLAIN\r\n250 OK\r\n"
const AUTH_OK = "235 OK\r\n"
const OK = "250 OK\r\n"
const DATA_READY = "354 Go\r\n"
const SEND_OK = "250 2.0.0 OK id=1\r\n"
const QUIT_OK = "221 Bye\r\n"
const EMAIL = { from: "a@t.com", to: "b@t.com", subject: "T", text: "hi" }
const STANDARD_SESSION = [GREETING, EHLO_STARTTLS, TLS_OK, EHLO_AUTH, AUTH_OK]
const BASE_OPTS = {
	host: "smtp.test.com",
	port: 587,
	username: "u@t.com",
	password: "p",
	authType: ["plain" as const],
}

function setupSocket(responses: string[]) {
	let index = 0
	const reader: { read: Mock; releaseLock: Mock } = {
		read: vi
			.fn()
			.mockImplementation(() =>
				index < responses.length
					? Promise.resolve({ value: encode(responses[index++]) })
					: new Promise(() => {}),
			),
		releaseLock: vi.fn(),
	}
	const writer = { write: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn() }
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
	vi.mocked(connect).mockReturnValue(socket as never)
	return { writer }
}

function decodeCommands(writer: { write: Mock }): string[] {
	return writer.write.mock.calls.map((call: [Uint8Array]) => new TextDecoder().decode(call[0]))
}

describe("MailPlugin", () => {
	beforeEach(() => vi.clearAllMocks())
	afterEach(() => vi.restoreAllMocks())

	it("runs hooks before user plugins", async () => {
		const seenSubjects: string[] = []
		const hooks: SendHooks = {
			beforeSend: (email) => ({ ...email, subject: "from-hooks" }),
		}
		const plugins: MailPlugin[] = [
			{
				name: "subject-checker",
				beforeSend: (email) => {
					seenSubjects.push(email.subject)
				},
				afterSend: vi.fn(),
			},
		]
		setupSocket([...STANDARD_SESSION, OK, OK, DATA_READY, SEND_OK, QUIT_OK])
		const mailer = await WorkerMailer.connect({ ...BASE_OPTS, hooks, plugins })
		await mailer.send(EMAIL)
		await mailer.close()
		expect(seenSubjects).toEqual(["from-hooks"])
		expect(plugins[0].afterSend).toHaveBeenCalledWith(
			expect.objectContaining({ subject: "from-hooks" }),
			expect.objectContaining({ messageId: expect.any(String) }),
		)
	})

	it("dry run skips DATA and reports accepted and rejected recipients", async () => {
		const afterSend = vi.fn()
		const { writer } = setupSocket([
			...STANDARD_SESSION,
			OK,
			"250 accepted\r\n",
			"550 rejected\r\n",
			OK,
			QUIT_OK,
		])
		const mailer = await WorkerMailer.connect({
			...BASE_OPTS,
			hooks: { afterSend },
		})
		const result = await mailer.send({ ...EMAIL, to: ["ok@t.com", "bad@t.com"] }, { dryRun: true })
		await mailer.close()
		const commands = decodeCommands(writer)
		expect(result.messageId).toBe("")
		expect(result.accepted).toEqual(["ok@t.com"])
		expect(result.rejected).toEqual(["bad@t.com"])
		expect(result.response).toBe("DRY RUN: no message sent")
		expect(commands.some((command) => command.includes("DATA"))).toBe(false)
		expect(commands.some((command) => command.includes("RSET"))).toBe(true)
		expect(afterSend).toHaveBeenCalledWith(
			expect.objectContaining({ to: ["ok@t.com", "bad@t.com"] }),
			expect.objectContaining({ messageId: "", rejected: ["bad@t.com"] }),
		)
	})

	it("telemetry plugin emits connect, send, and disconnect events", async () => {
		const events: TelemetryEvent[] = []
		setupSocket([...STANDARD_SESSION, OK, OK, DATA_READY, SEND_OK, QUIT_OK])
		const mailer = await WorkerMailer.connect({
			...BASE_OPTS,
			plugins: [telemetryPlugin({ onEvent: (event) => void events.push(event) })],
		})
		await mailer.send(EMAIL)
		await mailer.close()
		expect(events[0]).toEqual({ type: "connect", host: "smtp.test.com", port: 587 })
		expect(events[1]).toEqual(
			expect.objectContaining({
				type: "send",
				recipientCount: 1,
				email: expect.objectContaining({ subject: "T" }),
				result: expect.objectContaining({ accepted: ["b@t.com"] }),
			}),
		)
		expect(events[1]?.type === "send" ? events[1].durationMs : -1).toBeGreaterThanOrEqual(0)
		expect(events[2]).toEqual({ type: "disconnect", reason: undefined })
	})

	it("telemetry plugin emits error events on send failure", async () => {
		const events: TelemetryEvent[] = []
		setupSocket([...STANDARD_SESSION, "550 denied\r\n", OK, QUIT_OK])
		const mailer = await WorkerMailer.connect({
			...BASE_OPTS,
			maxRetries: 0,
			plugins: [telemetryPlugin({ onEvent: (event) => void events.push(event) })],
		})
		await expect(mailer.send(EMAIL)).rejects.toThrow()
		await mailer.close()
		expect(events.some((event) => event.type === "error")).toBe(true)
	})
})

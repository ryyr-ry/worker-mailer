import { Email } from "./email/email"
import type { EmailOptions } from "./email/types"
import { SmtpConnectionError } from "./errors"
import type { Mailer, SendOptions } from "./mailer"
import {
	assertNotSentTo,
	assertNthSent,
	assertSendCount,
	assertSent,
	type SentEmailAssertion,
} from "./mock-assertions"
import { normalizeRecipients, type SentEmail } from "./mock-shared"
import type { SendResult } from "./result"

export type MockMailerOptions = {
	simulateError?: Error
	simulateDelay?: number
}

export type { SentEmail } from "./mock-shared"

export class MockMailer implements Mailer {
	private readonly mockOptions: MockMailerOptions
	private _connected = true
	private _sentEmails: SentEmail[] = []
	private messageCounter = 0

	constructor(options?: MockMailerOptions) {
		this.mockOptions = options ?? {}
	}

	async send(options: EmailOptions, _sendOptions?: SendOptions): Promise<SendResult> {
		if (!this._connected) throw new SmtpConnectionError("[MockMailer] Not connected")
		new Email(options)
		if (this.mockOptions.simulateDelay) {
			await new Promise<void>((resolve) => setTimeout(resolve, this.mockOptions.simulateDelay))
		}
		if (this.mockOptions.simulateError) throw this.mockOptions.simulateError

		this.messageCounter++
		const messageId = `<mock-${this.messageCounter}-${Date.now()}@mock.local>`
		const allRecipients = normalizeRecipients(options.to)
			.concat(options.cc ? normalizeRecipients(options.cc) : [])
			.concat(options.bcc ? normalizeRecipients(options.bcc) : [])

		const result: SendResult = {
			messageId,
			accepted: allRecipients,
			rejected: [],
			responseTime: this.mockOptions.simulateDelay ?? 0,
			response: "250 2.0.0 Ok: queued as mock",
		}
		this._sentEmails.push({
			options: { ...options },
			result: { ...result },
			sentAt: new Date(),
		})
		return result
	}

	async close(): Promise<void> {
		this._connected = false
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.close()
	}

	async ping(): Promise<boolean> {
		return this._connected
	}

	get connected(): boolean {
		return this._connected
	}

	get sentEmails(): ReadonlyArray<SentEmail> {
		return this._sentEmails
	}

	get lastEmail(): SentEmail | undefined {
		return this._sentEmails.at(-1)
	}

	get sendCount(): number {
		return this._sentEmails.length
	}

	assertSent(): SentEmailAssertion {
		return assertSent(this)
	}

	assertNthSent(position: number): SentEmailAssertion {
		return assertNthSent(this, position)
	}

	assertNotSentTo(email: string): void {
		assertNotSentTo(this, email)
	}

	assertSendCount(expected: number): void {
		assertSendCount(this, expected)
	}

	hasSentTo(email: string): boolean {
		return this._sentEmails.some((e) => normalizeRecipients(e.options.to).includes(email))
	}

	hasSentWithSubject(subject: string): boolean {
		return this._sentEmails.some((e) => e.options.subject === subject)
	}

	clear(): void {
		this._sentEmails = []
		this.messageCounter = 0
		this._connected = true
	}
}

export { normalizeRecipients } from "./mock-shared"

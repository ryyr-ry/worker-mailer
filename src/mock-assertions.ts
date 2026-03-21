import type { EmailOptions } from "./email/types"
import { normalizeRecipients, type SentEmail } from "./mock-shared"

export type { SentEmail }

export interface HasSentEmails {
	readonly sentEmails: ReadonlyArray<SentEmail>
}

export class SentEmailAssertion {
	private readonly emails: ReadonlyArray<SentEmail>
	private readonly filters: Array<(e: SentEmail) => boolean> = []

	constructor(emails: ReadonlyArray<SentEmail>) {
		this.emails = emails
	}

	to(email: string): this {
		this.filters.push((e) => getAllRecipients(e.options).includes(email))
		return this
	}

	from(email: string): this {
		this.filters.push((e) => resolveEmail(e.options.from) === email)
		return this
	}

	withSubject(subject: string | RegExp): this {
		const test =
			typeof subject === "string" ? (s: string) => s === subject : (s: string) => subject.test(s)
		this.filters.push((e) => test(e.options.subject))
		return this
	}

	withText(text: string): this {
		this.filters.push((e) => e.options.text?.includes(text) === true)
		return this
	}

	withHtml(html: string): this {
		this.filters.push((e) => e.options.html?.includes(html) === true)
		return this
	}

	withAttachment(filename: string): this {
		this.filters.push((e) => e.options.attachments?.some((a) => a.filename === filename) === true)
		return this
	}

	withHeader(name: string, value?: string): this {
		this.filters.push((e) => {
			const v = e.options.headers?.[name]
			return value === undefined ? v !== undefined : v === value
		})
		return this
	}

	exists(): SentEmail {
		const matches = this.getMatches()
		if (matches.length === 0) {
			throw new Error("Expected at least 1 matching email, found 0")
		}
		return matches[0]
	}

	exactly(count: number): SentEmail[] {
		const matches = this.getMatches()
		if (matches.length !== count) {
			throw new Error(`Expected exactly ${count} matching email(s), found ${matches.length}`)
		}
		return matches
	}

	atLeast(count: number): SentEmail[] {
		const matches = this.getMatches()
		if (matches.length < count) {
			throw new Error(`Expected at least ${count} matching email(s), found ${matches.length}`)
		}
		return matches
	}

	private getMatches(): SentEmail[] {
		return this.emails.filter((e) => this.filters.every((f) => f(e)))
	}
}

export function assertSent(source: HasSentEmails): SentEmailAssertion {
	return new SentEmailAssertion(source.sentEmails)
}

export function assertNthSent(source: HasSentEmails, position: number): SentEmailAssertion {
	if (!Number.isInteger(position) || position < 1) {
		throw new Error(`Expected a positive integer position, got ${position}`)
	}
	const email = source.sentEmails[position - 1]
	if (!email) {
		throw new Error(`Expected sent email #${position}, but only ${source.sentEmails.length} exist`)
	}
	return new SentEmailAssertion([email])
}

export function assertSendCount(source: HasSentEmails, expected: number): void {
	const actual = source.sentEmails.length
	if (actual !== expected) {
		throw new Error(`Expected ${expected} sent email(s), got ${actual}`)
	}
}

export function assertNotSentTo(source: HasSentEmails, email: string): void {
	const found = source.sentEmails.some((e) => getAllRecipients(e.options).includes(email))
	if (found) {
		throw new Error(`Expected no email sent to ${email}, but found one`)
	}
}

function resolveEmail(from: EmailOptions["from"]): string {
	return typeof from === "string" ? from : from.email
}

function getAllRecipients(options: EmailOptions): string[] {
	return normalizeRecipients(options.to)
		.concat(options.cc ? normalizeRecipients(options.cc) : [])
		.concat(options.bcc ? normalizeRecipients(options.bcc) : [])
}

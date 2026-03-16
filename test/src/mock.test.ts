import { describe, expect, it } from "vitest"
import { sendBatch } from "../../src/batch"
import type { EmailOptions } from "../../src/email"
import { SmtpConnectionError } from "../../src/errors"
import type { Mailer } from "../../src/mailer"
import { MockMailer } from "../../src/mock"

const baseEmail: EmailOptions = {
	from: "sender@example.com",
	to: "recipient@example.com",
	subject: "Test Subject",
	text: "Hello",
}

describe("MockMailer", () => {
	it("send() returns a valid SendResult", async () => {
		const mailer = new MockMailer()
		const result = await mailer.send(baseEmail)
		expect(result.messageId).toMatch(/^<mock-\d+-\d+@mock\.local>$/)
		expect(result.accepted).toContain("recipient@example.com")
		expect(result.rejected).toEqual([])
		expect(result.response).toBe("250 2.0.0 Ok: queued as mock")
	})

	it("messageId is uniquely generated", async () => {
		const mailer = new MockMailer()
		const r1 = await mailer.send(baseEmail)
		const r2 = await mailer.send(baseEmail)
		expect(r1.messageId).not.toBe(r2.messageId)
	})

	it("accepted includes all recipients (to+cc+bcc)", async () => {
		const mailer = new MockMailer()
		const result = await mailer.send({
			...baseEmail,
			to: "a@example.com",
			cc: "b@example.com",
			bcc: ["c@example.com", "d@example.com"],
		})
		expect(result.accepted).toEqual([
			"a@example.com",
			"b@example.com",
			"c@example.com",
			"d@example.com",
		])
	})

	it("normalizes User-type recipients correctly", async () => {
		const mailer = new MockMailer()
		const result = await mailer.send({
			...baseEmail,
			to: { name: "Alice", email: "alice@example.com" },
			cc: [{ name: "Bob", email: "bob@example.com" }],
		})
		expect(result.accepted).toEqual(["alice@example.com", "bob@example.com"])
	})

	it("throws on simulateError", async () => {
		const mailer = new MockMailer({ simulateError: new Error("SMTP failure") })
		await expect(mailer.send(baseEmail)).rejects.toThrow("SMTP failure")
	})

	it("delays on simulateDelay", async () => {
		const mailer = new MockMailer({ simulateDelay: 50 })
		const start = Date.now()
		await mailer.send(baseEmail)
		expect(Date.now() - start).toBeGreaterThanOrEqual(40)
	})

	it("send() after close() throws error", async () => {
		const mailer = new MockMailer()
		await mailer.close()
		await expect(mailer.send(baseEmail)).rejects.toThrow(SmtpConnectionError)
	})

	it("clear() resets sent history", async () => {
		const mailer = new MockMailer()
		await mailer.send(baseEmail)
		expect(mailer.sendCount).toBe(1)
		mailer.clear()
		expect(mailer.sendCount).toBe(0)
		expect(mailer.sentEmails).toEqual([])
	})

	it("clear() restores connected state", async () => {
		const mailer = new MockMailer()
		await mailer.close()
		expect(mailer.connected).toBe(false)
		mailer.clear()
		expect(mailer.connected).toBe(true)
	})

	it("hasSentTo() returns correct result", async () => {
		const mailer = new MockMailer()
		await mailer.send(baseEmail)
		expect(mailer.hasSentTo("recipient@example.com")).toBe(true)
		expect(mailer.hasSentTo("other@example.com")).toBe(false)
	})

	it("hasSentWithSubject() returns correct result", async () => {
		const mailer = new MockMailer()
		await mailer.send(baseEmail)
		expect(mailer.hasSentWithSubject("Test Subject")).toBe(true)
		expect(mailer.hasSentWithSubject("Other Subject")).toBe(false)
	})

	it("lastEmail returns the last sent email", async () => {
		const mailer = new MockMailer()
		await mailer.send(baseEmail)
		const secondEmail = { ...baseEmail, subject: "Second" }
		await mailer.send(secondEmail)
		expect(mailer.lastEmail?.options.subject).toBe("Second")
	})

	it("sendCount returns correct count", async () => {
		const mailer = new MockMailer()
		expect(mailer.sendCount).toBe(0)
		await mailer.send(baseEmail)
		expect(mailer.sendCount).toBe(1)
		await mailer.send(baseEmail)
		expect(mailer.sendCount).toBe(2)
	})

	it("Symbol.asyncDispose calls close()", async () => {
		const mailer = new MockMailer()
		expect(mailer.connected).toBe(true)
		await mailer[Symbol.asyncDispose]()
		expect(mailer.connected).toBe(false)
	})

	it("sendBatch() accepts MockMailer", async () => {
		const mailer = new MockMailer()
		const results = await sendBatch(mailer, [baseEmail, { ...baseEmail, subject: "Second" }])
		expect(results).toHaveLength(2)
		expect(results.every((r) => r.success)).toBe(true)
		expect(mailer.sendCount).toBe(2)
	})

	it("satisfies the Mailer interface", () => {
		const mock = new MockMailer()
		const mailer: Mailer = mock
		expect(typeof mailer.send).toBe("function")
		expect(typeof mailer.close).toBe("function")
		expect(typeof mailer.ping).toBe("function")
		expect(typeof mailer[Symbol.asyncDispose]).toBe("function")
	})

	it("sentEmails is readonly", () => {
		const mailer = new MockMailer()
		const emails: ReadonlyArray<unknown> = mailer.sentEmails
		expect(Array.isArray(emails)).toBe(true)
	})
})

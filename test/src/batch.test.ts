import { describe, expect, it, vi } from "vitest"
import { sendBatch } from "../../src/batch"
import type { EmailOptions } from "../../src/email/types"
import type { Mailer } from "../../src/mailer"
import type { SendResult } from "../../src/result"

function makeMockMailer(results: Array<SendResult | Error>): Mailer {
let callIndex = 0
return {
send: vi.fn(async () => {
const r = results[callIndex++]
if (r instanceof Error) throw r
return r
}),
close: vi.fn(async () => {}),
ping: vi.fn(async () => true),
[Symbol.asyncDispose]: vi.fn(async () => {}),
} as unknown as Mailer
}

function makeResult(id: string): SendResult {
return { messageId: id, accepted: [], rejected: [], responseTime: 0, response: "250 OK" }
}

const email1: EmailOptions = { from: "a@b.com", to: "c@d.com", subject: "1" }
const email2: EmailOptions = { from: "a@b.com", to: "e@f.com", subject: "2" }
const email3: EmailOptions = { from: "a@b.com", to: "g@h.com", subject: "3" }

describe("sendBatch", () => {
it("sends all emails and returns results", async () => {
const mailer = makeMockMailer([makeResult("1"), makeResult("2")])
const results = await sendBatch(mailer, [email1, email2])
expect(results).toHaveLength(2)
expect(results[0].success).toBe(true)
expect(results[1].success).toBe(true)
})

it("continueOnError=true: one fails, rest continue", async () => {
const mailer = makeMockMailer([new Error("fail"), makeResult("2")])
const results = await sendBatch(mailer, [email1, email2], { continueOnError: true })
expect(results).toHaveLength(2)
expect(results[0].success).toBe(false)
expect(results[0].error?.message).toBe("fail")
expect(results[1].success).toBe(true)
})

it("continueOnError=false: stops on first error", async () => {
const mailer = makeMockMailer([new Error("fail"), makeResult("2")])
const results = await sendBatch(mailer, [email1, email2], { continueOnError: false })
expect(results).toHaveLength(1)
expect(results[0].success).toBe(false)
})

it("empty email array returns empty results", async () => {
const mailer = makeMockMailer([])
const results = await sendBatch(mailer, [])
expect(results).toHaveLength(0)
})

it("single email works", async () => {
const mailer = makeMockMailer([makeResult("only")])
const results = await sendBatch(mailer, [email1])
expect(results).toHaveLength(1)
expect(results[0].result?.messageId).toBe("only")
})

it("all fail: all results have success=false", async () => {
const mailer = makeMockMailer([new Error("e1"), new Error("e2")])
const results = await sendBatch(mailer, [email1, email2])
expect(results.every((r) => !r.success)).toBe(true)
})

it("error in result preserves original Error instance", async () => {
const err = new Error("specific")
const mailer = makeMockMailer([err])
const results = await sendBatch(mailer, [email1])
expect(results[0].error).toBe(err)
})

it("concurrency > 1 still processes all emails", async () => {
const mailer = makeMockMailer([makeResult("1"), makeResult("2"), makeResult("3")])
const results = await sendBatch(mailer, [email1, email2, email3], { concurrency: 2 })
expect(results).toHaveLength(3)
expect(results.every((r) => r.success)).toBe(true)
})

it("result contains original email reference", async () => {
const mailer = makeMockMailer([makeResult("1")])
const results = await sendBatch(mailer, [email1])
expect(results[0].email).toBe(email1)
})

it("default continueOnError is true", async () => {
const mailer = makeMockMailer([new Error("fail"), makeResult("2")])
const results = await sendBatch(mailer, [email1, email2])
expect(results).toHaveLength(2)
})
})

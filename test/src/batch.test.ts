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

function makeDelayMailer(
responses: Array<{ result: SendResult | Error; delay: number }>,
): { mailer: Mailer; callOrder: number[] } {
let callIndex = 0
const callOrder: number[] = []
const mailer = {
send: vi.fn(async () => {
const idx = callIndex++
const { result, delay } = responses[idx]
await new Promise((r) => setTimeout(r, delay))
callOrder.push(idx)
if (result instanceof Error) throw result
return result
}),
close: vi.fn(async () => {}),
ping: vi.fn(async () => true),
[Symbol.asyncDispose]: vi.fn(async () => {}),
} as unknown as Mailer
return { mailer, callOrder }
}

function makeStringThrowMailer(): Mailer {
return {
send: vi.fn(async () => {
throw "raw string error"
}),
close: vi.fn(async () => {}),
ping: vi.fn(async () => true),
[Symbol.asyncDispose]: vi.fn(async () => {}),
} as unknown as Mailer
}

describe("sendBatch - concurrency edge cases", () => {
it("concurrency=0 falls back to sequential processing", async () => {
const { mailer, callOrder } = makeDelayMailer([
{ result: makeResult("1"), delay: 10 },
{ result: makeResult("2"), delay: 5 },
])
const results = await sendBatch(mailer, [email1, email2], { concurrency: 0 })
expect(results).toHaveLength(2)
expect(callOrder).toEqual([0, 1])
})

it("concurrency=1 preserves sequential order", async () => {
const { mailer, callOrder } = makeDelayMailer([
{ result: makeResult("1"), delay: 15 },
{ result: makeResult("2"), delay: 5 },
{ result: makeResult("3"), delay: 1 },
])
const results = await sendBatch(mailer, [email1, email2, email3], { concurrency: 1 })
expect(results.map((r) => r.result?.messageId)).toEqual(["1", "2", "3"])
expect(callOrder).toEqual([0, 1, 2])
})

it("concurrency > emails.length sends all emails", async () => {
const mailer = makeMockMailer([makeResult("1"), makeResult("2"), makeResult("3")])
const results = await sendBatch(mailer, [email1, email2, email3], { concurrency: 10 })
expect(results).toHaveLength(3)
expect(results.every((r) => r.success)).toBe(true)
})

it("empty emails with concurrency > 1 returns empty", async () => {
const mailer = makeMockMailer([])
const results = await sendBatch(mailer, [], { concurrency: 5 })
expect(results).toHaveLength(0)
})

it("continueOnError=true with all failures returns all errors", async () => {
const mailer = makeMockMailer([new Error("e1"), new Error("e2"), new Error("e3")])
const results = await sendBatch(mailer, [email1, email2, email3], {
concurrency: 2,
continueOnError: true,
})
expect(results).toHaveLength(3)
expect(results.every((r) => !r.success)).toBe(true)
expect(results.every((r) => r.error instanceof Error)).toBe(true)
})

it("continueOnError=false stops early on first failure (concurrent)", async () => {
const { mailer } = makeDelayMailer([
{ result: new Error("fail-first"), delay: 1 },
{ result: makeResult("2"), delay: 50 },
{ result: makeResult("3"), delay: 50 },
])
const results = await sendBatch(mailer, [email1, email2, email3], {
concurrency: 2,
continueOnError: false,
})
expect(results.length).toBeLessThanOrEqual(3)
expect(results.some((r) => !r.success)).toBe(true)
})

it("continueOnError=false: in-flight sends may complete but aborted ones are excluded", async () => {
const { mailer } = makeDelayMailer([
{ result: new Error("fail"), delay: 1 },
{ result: makeResult("2"), delay: 10 },
{ result: makeResult("3"), delay: 200 },
{ result: makeResult("4"), delay: 200 },
])
const results = await sendBatch(mailer, [email1, email2, email3, email3], {
concurrency: 2,
continueOnError: false,
})
expect(results.length).toBeLessThan(4)
const failed = results.filter((r) => !r.success)
expect(failed.length).toBeGreaterThanOrEqual(1)
})

it("mixed success/failure with continueOnError=true (concurrent)", async () => {
const mailer = makeMockMailer([
makeResult("1"),
new Error("fail"),
makeResult("3"),
])
const results = await sendBatch(mailer, [email1, email2, email3], {
concurrency: 2,
continueOnError: true,
})
expect(results).toHaveLength(3)
expect(results.filter((r) => r.success)).toHaveLength(2)
expect(results.filter((r) => !r.success)).toHaveLength(1)
})

it("non-Error throw is wrapped in Error (sequential)", async () => {
const mailer = makeStringThrowMailer()
const results = await sendBatch(mailer, [email1])
expect(results).toHaveLength(1)
expect(results[0].success).toBe(false)
expect(results[0].error).toBeInstanceOf(Error)
expect(results[0].error?.message).toBe("raw string error")
})

it("non-Error throw is wrapped in Error (concurrent)", async () => {
const mailer = makeStringThrowMailer()
const results = await sendBatch(mailer, [email1, email2], { concurrency: 2 })
expect(results.some((r) => !r.success)).toBe(true)
const failed = results.find((r) => !r.success)
expect(failed?.error).toBeInstanceOf(Error)
expect(failed?.error?.message).toBe("raw string error")
})

it("large batch (20 emails) with concurrency=3", async () => {
const count = 20
const emails = Array.from({ length: count }, (_, i) => ({
from: "a@b.com",
to: `user${i}@test.com`,
subject: `Email ${i}`,
}))
const mockResults = emails.map((_, i) => makeResult(`id-${i}`))
const mailer = makeMockMailer(mockResults)
const results = await sendBatch(mailer, emails, { concurrency: 3 })
expect(results).toHaveLength(count)
expect(results.every((r) => r.success)).toBe(true)
expect(mailer.send).toHaveBeenCalledTimes(count)
})
})

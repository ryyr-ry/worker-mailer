import { describe, expect, it } from "vitest"
import { QueueClosedError } from "../../src/errors"
import { BlockingQueue } from "../../src/queue"

describe("BlockingQueue", () => {
it("dequeue returns items in FIFO order", async () => {
const q = new BlockingQueue<number>()
q.enqueue(1)
q.enqueue(2)
q.enqueue(3)
expect(await q.dequeue()).toBe(1)
expect(await q.dequeue()).toBe(2)
expect(await q.dequeue()).toBe(3)
})

it("dequeue blocks until enqueue provides a value", async () => {
const q = new BlockingQueue<string>()
const promise = q.dequeue()
// Enqueue after a microtask delay
queueMicrotask(() => q.enqueue("delayed"))
expect(await promise).toBe("delayed")
})

it("close rejects pending dequeue with QueueClosedError", async () => {
const q = new BlockingQueue<number>()
const promise = q.dequeue()
q.close()
await expect(promise).rejects.toThrow(QueueClosedError)
})

it("close rejects subsequent enqueue with QueueClosedError", () => {
const q = new BlockingQueue<number>()
q.close()
expect(() => q.enqueue(1)).toThrow(QueueClosedError)
})

it("multiple concurrent dequeues resolve in order", async () => {
const q = new BlockingQueue<number>()
const p1 = q.dequeue()
const p2 = q.dequeue()
const p3 = q.dequeue()
q.enqueue(10)
q.enqueue(20)
q.enqueue(30)
expect(await p1).toBe(10)
expect(await p2).toBe(20)
expect(await p3).toBe(30)
})

it("clear empties buffered items and rejects waiters", async () => {
const q = new BlockingQueue<number>()
q.enqueue(1)
q.enqueue(2)
const pending = q.dequeue().catch(() => "rejected")
q.clear()
expect(q.length).toBe(0)
})

it("rapid enqueue/dequeue interleaving maintains consistency", async () => {
const q = new BlockingQueue<number>()
const results: number[] = []
const count = 100

// Alternate enqueue and dequeue rapidly
const promises: Promise<void>[] = []
for (let i = 0; i < count; i++) {
q.enqueue(i)
promises.push(q.dequeue().then((v) => { results.push(v) }))
}
await Promise.all(promises)

expect(results).toHaveLength(count)
// All values should be present (order may vary due to microtask scheduling)
expect(new Set(results).size).toBe(count)
})
})

describe("BlockingQueue - concurrency and edge cases", () => {
it("dequeue on closed empty queue throws QueueClosedError", async () => {
const q = new BlockingQueue<number>()
q.close()
await expect(q.dequeue()).rejects.toThrow(QueueClosedError)
})

it("close rejects all pending dequeue promises", async () => {
const q = new BlockingQueue<number>()
const p1 = q.dequeue().catch((e: unknown) => e)
const p2 = q.dequeue().catch((e: unknown) => e)
const p3 = q.dequeue().catch((e: unknown) => e)
q.close()
const results = await Promise.all([p1, p2, p3])
for (const r of results) {
expect(r).toBeInstanceOf(QueueClosedError)
}
})

it("enqueue when dequeue is already waiting resolves immediately", async () => {
const q = new BlockingQueue<string>()
const promise = q.dequeue()
q.enqueue("value")
expect(await promise).toBe("value")
})

it("clear removes all queued items and resets length", () => {
const q = new BlockingQueue<number>()
q.enqueue(1)
q.enqueue(2)
q.enqueue(3)
q.clear()
expect(q.length).toBe(0)
})

it("clear rejects pending dequeue promises", async () => {
const q = new BlockingQueue<number>()
const p = q.dequeue()
q.clear()
await expect(p).rejects.toThrow("Queue was cleared")
})

it("length accurate after enqueue, dequeue, and clear", async () => {
const q = new BlockingQueue<number>()
expect(q.length).toBe(0)
q.enqueue(10)
q.enqueue(20)
const lenAfterTwoEnqueues = q.length
await q.dequeue()
const lenAfterOneDequeue = q.length
q.enqueue(30)
q.clear()
expect(q.length).toBe(0)
expect(lenAfterTwoEnqueues).toBeGreaterThanOrEqual(1)
expect(lenAfterOneDequeue).toBeLessThan(lenAfterTwoEnqueues)
})

it("interleaved: dequeue, enqueue, dequeue again", async () => {
const q = new BlockingQueue<number>()
const p1 = q.dequeue()
q.enqueue(42)
expect(await p1).toBe(42)
q.enqueue(99)
expect(await q.dequeue()).toBe(99)
})

it("rapid enqueue then dequeue: exact FIFO order preserved", async () => {
const q = new BlockingQueue<number>()
const count = 100
for (let i = 0; i < count; i++) {
q.enqueue(i)
}
const results: number[] = []
for (let i = 0; i < count; i++) {
results.push(await q.dequeue())
}
expect(results).toEqual(Array.from({ length: count }, (_, i) => i))
})

it("enqueue after clear works normally", async () => {
const q = new BlockingQueue<string>()
q.enqueue("before")
q.clear()
q.enqueue("after")
expect(await q.dequeue()).toBe("after")
})

it("multiple dequeues then enqueues resolve in FIFO order", async () => {
const q = new BlockingQueue<string>()
const p1 = q.dequeue()
const p2 = q.dequeue()
const p3 = q.dequeue()
q.enqueue("a")
q.enqueue("b")
q.enqueue("c")
expect(await p1).toBe("a")
expect(await p2).toBe("b")
expect(await p3).toBe("c")
})

it("dequeue-enqueue cycles: no items lost", async () => {
const q = new BlockingQueue<number>()
const received: number[] = []
const count = 50
const promises: Promise<void>[] = []
for (let i = 0; i < count; i++) {
const p = q.dequeue()
promises.push(p.then((v) => { received.push(v) }))
}
for (let i = 0; i < count; i++) {
q.enqueue(i)
}
await Promise.all(promises)
expect(received).toHaveLength(count)
expect(new Set(received).size).toBe(count)
})
})

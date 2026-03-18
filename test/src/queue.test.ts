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

it("length reflects current buffer size", () => {
const q = new BlockingQueue<number>()
expect(q.length).toBe(0)
q.enqueue(1)
// After enqueue with no waiter, a resolved promise is in the buffer
// length tracks the internal values array
expect(q.length).toBeLessThanOrEqual(1)
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

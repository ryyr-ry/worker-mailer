import { QueueClosedError } from "./errors"

export class BlockingQueue<T> {
	private values: Promise<T>[] = []
	private resolvers: ((value: T) => void)[] = []
	private rejecters: ((reason: Error) => void)[] = []
	private _closed = false

	public enqueue(value: T) {
		if (this._closed) {
			throw new QueueClosedError()
		}
		if (!this.resolvers.length) {
			this.addWrapper()
		}
		this.resolvers.shift()?.(value)
		this.rejecters.shift()
	}

	public async dequeue(): Promise<T> {
		if (this._closed) {
			throw new QueueClosedError()
		}
		if (!this.values.length) {
			this.addWrapper()
		}
		return this.values.shift() as Promise<T>
	}

	public get length(): number {
		return this.values.length
	}

	public get closed(): boolean {
		return this._closed
	}

	public clear() {
		this.rejectAll(new Error("Queue was cleared"))
	}

	public close() {
		this._closed = true
		this.rejectAll(new QueueClosedError())
	}

	private rejectAll(reason: Error) {
		for (const reject of this.rejecters) {
			reject(reason)
		}
		this.values = []
		this.resolvers = []
		this.rejecters = []
	}

	private addWrapper() {
		this.values.push(
			new Promise<T>((resolve, reject) => {
				this.resolvers.push(resolve)
				this.rejecters.push(reject)
			}),
		)
	}
}

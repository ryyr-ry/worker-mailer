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

export async function execTimeout<T>(promise: Promise<T>, ms: number, e: Error) {
	return Promise.race<T>([promise, new Promise((_, reject) => setTimeout(() => reject(e), ms))])
}

export function backoff(attempt: number): Promise<void> {
	return new Promise<void>((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30_000)))
}

const encoder = new TextEncoder()
export function encode(data: string): Uint8Array {
	return encoder.encode(data)
}

export function toBase64(data: string): string {
	const bytes = encoder.encode(data)
	let binary = ""
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary)
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer)
	let binary = ""
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary)
}

const decoder = new TextDecoder("utf-8")
export function decode(data: Uint8Array): string {
	return decoder.decode(data)
}

function encodeQpByte(byte: number, isTrailingWhitespace: boolean): string {
	const isWhitespace = byte === 0x20 || byte === 0x09
	const needsEncoding =
		(byte < 32 && !isWhitespace) ||
		byte > 126 ||
		byte === 61 ||
		(isWhitespace && isTrailingWhitespace)
	if (needsEncoding) return `=${byte.toString(16).toUpperCase().padStart(2, "0")}`
	return String.fromCharCode(byte)
}

function consumeNewline(bytes: Uint8Array, i: number): number {
	if (bytes[i] === 0x0a) return 1
	if (bytes[i] === 0x0d && i + 1 < bytes.length && bytes[i + 1] === 0x0a) return 2
	return 0
}

function resolveQpEncoding(bytes: Uint8Array, i: number): string {
	if (bytes[i] === 0x0d) return "=0D"
	const isTrailing = i + 1 >= bytes.length || bytes[i + 1] === 0x0a || bytes[i + 1] === 0x0d
	return encodeQpByte(bytes[i], isTrailing)
}

export function encodeQuotedPrintable(text: string, lineLength = 76): string {
	const bytes = encode(text)
	let result = ""
	let lineLen = 0
	let i = 0

	while (i < bytes.length) {
		const skip = consumeNewline(bytes, i)
		if (skip > 0) {
			result += "\r\n"
			lineLen = 0
			i += skip
			continue
		}
		const encoded = resolveQpEncoding(bytes, i)
		const newLen = lineLen + encoded.length
		if (newLen > lineLength || (newLen === lineLength && i + 1 < bytes.length)) {
			result += "=\r\n"
			lineLen = 0
		}
		result += encoded
		lineLen += encoded.length
		i++
	}
	return result
}

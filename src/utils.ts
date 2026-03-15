export class BlockingQueue<T> {
	private values: Promise<T>[] = []
	private resolvers: ((value: T) => void)[] = []
	private rejecters: ((reason: Error) => void)[] = []
	private _closed = false

	public enqueue(value: T) {
		if (this._closed) {
			throw new Error("Queue is closed")
		}
		if (!this.resolvers.length) {
			this.addWrapper()
		}
		this.resolvers.shift()?.(value)
		this.rejecters.shift()
	}

	public async dequeue(): Promise<T> {
		if (this._closed) {
			return Promise.reject(new Error("Queue is closed"))
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
		this.rejectAll(new Error("Queue is closed"))
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

const decoder = new TextDecoder("utf-8")
export function decode(data: Uint8Array): string {
	return decoder.decode(data)
}

export function encodeQuotedPrintable(text: string, lineLength = 76): string {
	const bytes = encode(text)
	let result = ""
	let currentLineLength = 0
	let i = 0

	while (i < bytes.length) {
		const byte = bytes[i]
		let encoded: string | undefined

		// Handle line breaks (LF, CR, CRLF)
		if (byte === 0x0a) {
			// LF
			result += "\r\n"
			currentLineLength = 0
			i++
			continue
		} else if (byte === 0x0d) {
			// CR
			if (i + 1 < bytes.length && bytes[i + 1] === 0x0a) {
				// CRLF
				result += "\r\n"
				currentLineLength = 0
				i += 2
				continue
			} else {
				// Standalone CR - encode it
				encoded = "=0D"
			}
		}

		// If not already encoded (e.g., standalone CR), check if encoding is needed
		if (encoded === undefined) {
			// Check if this is trailing whitespace (space or tab at end of line)
			const isWhitespace = byte === 0x20 || byte === 0x09
			const nextIsLineBreak =
				i + 1 >= bytes.length || bytes[i + 1] === 0x0a || bytes[i + 1] === 0x0d

			// Encode if:
			// 1. Non-printable (< 32 or > 126, excluding space and tab)
			// 2. Equals sign (=)
			// 3. Trailing whitespace (space or tab before line break or end of text)
			const needsEncoding =
				(byte < 32 && !isWhitespace) || // Control characters (but not space/tab)
				byte > 126 || // Non-ASCII
				byte === 61 || // Equals sign
				(isWhitespace && nextIsLineBreak) // Trailing whitespace

			if (needsEncoding) {
				encoded = `=${byte.toString(16).toUpperCase().padStart(2, "0")}`
			} else {
				encoded = String.fromCharCode(byte)
			}
		}

		if (currentLineLength + encoded.length > lineLength) {
			result += "=\r\n"
			currentLineLength = 0
		}

		result += encoded
		currentLineLength += encoded.length
		i++
	}

	return result
}

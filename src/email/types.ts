export type User = { name?: string; email: string }

export type EmailOptions = {
	from: string | User
	to: string | string[] | User | User[]
	reply?: string | User
	cc?: string | string[] | User | User[]
	bcc?: string | string[] | User | User[]
	subject: string
	text?: string
	html?: string
	headers?: Record<string, string>
	attachments?: {
		filename: string
		content: string | Uint8Array | ArrayBuffer
		mimeType?: string
	}[]
	dsnOverride?: {
		envelopeId?: string
		RET?: {
			HEADERS?: boolean
			FULL?: boolean
		}
		NOTIFY?: {
			DELAY?: boolean
			FAILURE?: boolean
			SUCCESS?: boolean
		}
	}
}

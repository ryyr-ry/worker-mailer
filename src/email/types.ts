export type User = { name?: string; email: string }

export type Attachment = {
	filename: string
	content: string | Uint8Array | ArrayBuffer
	mimeType?: string
}

export type InlineAttachment = {
	cid: string
	filename: string
	content: string | Uint8Array | ArrayBuffer
	mimeType?: string
}

export type CalendarEventPart = {
	content: string
	method?: "REQUEST" | "CANCEL" | "REPLY"
}

export type DsnOptions = {
	envelopeId?: string
	RET?: { HEADERS?: boolean; FULL?: boolean }
	NOTIFY?: { DELAY?: boolean; FAILURE?: boolean; SUCCESS?: boolean }
}

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
	attachments?: Attachment[]
	inlineAttachments?: InlineAttachment[]
	calendarEvent?: CalendarEventPart
	dsnOverride?: DsnOptions
}

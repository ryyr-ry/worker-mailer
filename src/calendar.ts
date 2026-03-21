import type { CalendarEventPart } from "./email/types"
import { CalendarValidationError } from "./errors"

export type CalendarEventOptions = {
	summary: string
	start: Date
	end: Date
	organizer: { name?: string; email: string }
	attendees?: { name?: string; email: string; rsvp?: boolean }[]
	location?: string
	description?: string
	uid?: string
	reminderMinutes?: number
	method?: "REQUEST" | "CANCEL" | "REPLY"
	url?: string
}

export function createCalendarEvent(options: CalendarEventOptions): CalendarEventPart {
	validateCalendarOptions(options)
	const method = options.method ?? "REQUEST"
	const uid = options.uid ?? crypto.randomUUID()
	const lines: string[] = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//worker-mailer//NONSGML v1.0//EN",
		`METHOD:${method}`,
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`DTSTART:${formatDateUtc(options.start)}`,
		`DTEND:${formatDateUtc(options.end)}`,
		`SUMMARY:${escapeIcalText(options.summary)}`,
	]

	appendOrganizer(lines, options.organizer)
	appendAttendees(lines, options.attendees)

	if (options.location) lines.push(`LOCATION:${escapeIcalText(options.location)}`)
	if (options.description) lines.push(`DESCRIPTION:${escapeIcalText(options.description)}`)
	if (options.url) {
		if (/[\r\n]/.test(options.url)) {
			throw new CalendarValidationError("[Calendar] URL must not contain CR or LF characters")
		}
		lines.push(`URL:${options.url}`)
	}

	lines.push(`DTSTAMP:${formatDateUtc(new Date())}`)

	appendReminder(lines, options.reminderMinutes)

	lines.push("END:VEVENT", "END:VCALENDAR")

	const content = lines.map(foldIcalLine).join("\r\n")
	return { content, method }
}

function validateCalendarOptions(options: CalendarEventOptions): void {
	if (!options.summary.trim()) {
		throw new CalendarValidationError("[Calendar] summary must not be empty")
	}
	if (options.start >= options.end) {
		throw new CalendarValidationError("[Calendar] start must be before end")
	}
	if (options.reminderMinutes !== undefined && options.reminderMinutes < 0) {
		throw new CalendarValidationError("[Calendar] reminderMinutes must not be negative")
	}
	if (options.uid !== undefined && /[\r\n]/.test(options.uid)) {
		throw new CalendarValidationError("[Calendar] UID must not contain CR or LF characters")
	}
}

function sanitizeEmail(email: string): string {
	if (/[\r\n]/.test(email)) {
		throw new CalendarValidationError("[Calendar] Email must not contain CR or LF characters")
	}
	return email
}

function quoteParamValue(value: string): string {
	if (/[\r\n]/.test(value)) {
		throw new CalendarValidationError(
			"[Calendar] Parameter value must not contain CR or LF characters",
		)
	}
	const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
	return `"${escaped}"`
}

function appendOrganizer(lines: string[], organizer: { name?: string; email: string }): void {
	const email = sanitizeEmail(organizer.email)
	if (organizer.name) {
		lines.push(`ORGANIZER;CN=${quoteParamValue(organizer.name)}:mailto:${email}`)
	} else {
		lines.push(`ORGANIZER:mailto:${email}`)
	}
}

function appendAttendees(
	lines: string[],
	attendees: { name?: string; email: string; rsvp?: boolean }[] | undefined,
): void {
	if (!attendees) return
	for (const att of attendees) {
		const rsvp = att.rsvp !== false ? "TRUE" : "FALSE"
		const cn = att.name ? `;CN=${quoteParamValue(att.name)}` : ""
		const email = sanitizeEmail(att.email)
		lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=${rsvp}${cn}:mailto:${email}`)
	}
}

function appendReminder(lines: string[], reminderMinutes: number | undefined): void {
	if (reminderMinutes === undefined) return
	lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder")
	lines.push(`TRIGGER:-PT${reminderMinutes}M`)
	lines.push("END:VALARM")
}

export function formatDateUtc(date: Date): string {
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, "0")
	const d = String(date.getUTCDate()).padStart(2, "0")
	const h = String(date.getUTCHours()).padStart(2, "0")
	const min = String(date.getUTCMinutes()).padStart(2, "0")
	const s = String(date.getUTCSeconds()).padStart(2, "0")
	return `${y}${m}${d}T${h}${min}${s}Z`
}

export function escapeIcalText(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r\n|\r|\n/g, "\\n")
}

export function foldIcalLine(line: string): string {
	const encoder = new TextEncoder()
	const bytes = encoder.encode(line)
	if (bytes.length <= 75) return line

	const parts: string[] = []
	let offset = 0
	let isFirst = true

	while (offset < bytes.length) {
		const maxLen = isFirst ? 75 : 74
		let end = Math.min(offset + maxLen, bytes.length)
		while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
			end--
		}
		const chunk = bytes.slice(offset, end)
		const decoded = new TextDecoder().decode(chunk)
		parts.push(isFirst ? decoded : ` ${decoded}`)
		offset = end
		isFirst = false
	}

	return parts.join("\r\n")
}

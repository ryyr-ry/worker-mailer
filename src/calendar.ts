import type { CalendarEventPart } from "./email/types"

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
	if (options.url) lines.push(`URL:${options.url}`)

	lines.push(`DTSTAMP:${formatDateUtc(new Date())}`)

	appendReminder(lines, options.reminderMinutes)

	lines.push("END:VEVENT", "END:VCALENDAR")

	const content = lines.map(foldIcalLine).join("\r\n")
	return { content, method }
}

function validateCalendarOptions(options: CalendarEventOptions): void {
	if (!options.summary.trim()) {
		throw new Error("[Calendar] summary must not be empty")
	}
	if (options.start >= options.end) {
		throw new Error("[Calendar] start must be before end")
	}
}

function appendOrganizer(lines: string[], organizer: { name?: string; email: string }): void {
	if (organizer.name) {
		lines.push(`ORGANIZER;CN=${escapeIcalText(organizer.name)}:mailto:${organizer.email}`)
	} else {
		lines.push(`ORGANIZER:mailto:${organizer.email}`)
	}
}

function appendAttendees(
	lines: string[],
	attendees: { name?: string; email: string; rsvp?: boolean }[] | undefined,
): void {
	if (!attendees) return
	for (const att of attendees) {
		const rsvp = att.rsvp !== false ? "TRUE" : "FALSE"
		const cn = att.name ? `;CN=${escapeIcalText(att.name)}` : ""
		lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=${rsvp}${cn}:mailto:${att.email}`)
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

import { describe, expect, it } from "vitest"
import {
	createCalendarEvent,
	escapeIcalText,
	foldIcalLine,
	formatDateUtc,
} from "../../src/calendar"
import { CalendarValidationError } from "../../src/errors"

const BASE = {
	summary: "Meeting",
	start: new Date("2025-01-15T10:00:00Z"),
	end: new Date("2025-01-15T11:00:00Z"),
	organizer: { email: "org@test.com" },
}

describe("Calendar event (RFC 5545)", () => {
	it("minimal event has BEGIN/END VCALENDAR and VEVENT", () => {
		const { content } = createCalendarEvent(BASE)
		expect(content).toContain("BEGIN:VCALENDAR")
		expect(content).toContain("END:VCALENDAR")
		expect(content).toContain("BEGIN:VEVENT")
		expect(content).toContain("END:VEVENT")
	})

	it("DTSTART and DTEND in UTC format YYYYMMDDTHHMMSSZ", () => {
		const { content } = createCalendarEvent(BASE)
		expect(content).toContain("DTSTART:20250115T100000Z")
		expect(content).toContain("DTEND:20250115T110000Z")
	})

	it("SUMMARY from options", () => {
		const { content } = createCalendarEvent(BASE)
		expect(content).toContain("SUMMARY:Meeting")
	})

	it("ORGANIZER from options", () => {
		const { content } = createCalendarEvent(BASE)
		expect(content).toContain("ORGANIZER")
		expect(content).toContain("org@test.com")
	})

	it("ATTENDEE for each attendee with RSVP", () => {
		const { content } = createCalendarEvent({
			...BASE,
			attendees: [{ email: "a@t.com" }, { email: "b@t.com", rsvp: true }],
		})
		expect(content).toContain("a@t.com")
		expect(content).toContain("b@t.com")
		expect(content).toContain("RSVP=TRUE")
	})

	it("LOCATION and DESCRIPTION properties", () => {
		const { content } = createCalendarEvent({
			...BASE,
			location: "Room 42",
			description: "Discuss plans",
		})
		expect(content).toContain("LOCATION:Room 42")
		expect(content).toContain("DESCRIPTION:Discuss plans")
	})

	it("VALARM with reminderMinutes", () => {
		const { content } = createCalendarEvent({ ...BASE, reminderMinutes: 15 })
		expect(content).toContain("BEGIN:VALARM")
		expect(content).toContain("TRIGGER:-PT15M")
		expect(content).toContain("END:VALARM")
	})

	it("METHOD from options and returned in part", () => {
		const part = createCalendarEvent({ ...BASE, method: "CANCEL" })
		expect(part.content).toContain("METHOD:CANCEL")
		expect(part.method).toBe("CANCEL")
	})

	it("UID auto-generated when not provided", () => {
		const { content } = createCalendarEvent(BASE)
		expect(content).toMatch(/UID:.+/)
	})

	it("UID from options when provided", () => {
		const { content } = createCalendarEvent({ ...BASE, uid: "custom-uid-123" })
		expect(content).toContain("UID:custom-uid-123")
	})

	it("URL property included", () => {
		const { content } = createCalendarEvent({ ...BASE, url: "https://example.com" })
		expect(content).toContain("URL:https://example.com")
	})

	it("returns CalendarEventPart with content and method", () => {
		const part = createCalendarEvent(BASE)
		expect(typeof part.content).toBe("string")
		expect(part.content.length).toBeGreaterThan(0)
	})
})

describe("Calendar validation", () => {
	it("end before start rejected", () => {
		expect(() =>
			createCalendarEvent({
				...BASE,
				start: new Date("2025-01-15T12:00:00Z"),
				end: new Date("2025-01-15T10:00:00Z"),
			}),
		).toThrow(CalendarValidationError)
	})

	it("empty summary rejected", () => {
		expect(() => createCalendarEvent({ ...BASE, summary: "  " })).toThrow(CalendarValidationError)
	})

	it("negative reminderMinutes rejected", () => {
		expect(() => createCalendarEvent({ ...BASE, reminderMinutes: -1 })).toThrow(
			CalendarValidationError,
		)
	})
})

describe("Calendar security (CRLF injection)", () => {
	it("CRLF in organizer email throws CalendarValidationError", () => {
		expect(() =>
			createCalendarEvent({
				...BASE,
				organizer: { email: "org@test.com\r\nX-Evil:injected" },
			}),
		).toThrow(CalendarValidationError)
	})

	it("CRLF in attendee email throws CalendarValidationError", () => {
		expect(() =>
			createCalendarEvent({
				...BASE,
				attendees: [{ email: "a@t.com\r\nX-Evil:bad" }],
			}),
		).toThrow(CalendarValidationError)
	})

	it("CRLF in summary escaped, no injected property line", () => {
		const { content } = createCalendarEvent({
			...BASE,
			summary: "Hi\r\nX-Evil:bad",
		})
		const lines = content.split("\r\n")
		expect(lines.some((l) => l.startsWith("X-Evil"))).toBe(false)
	})

	it("URL with CRLF throws CalendarValidationError", () => {
		expect(() =>
			createCalendarEvent({
				...BASE,
				url: "https://example.com\r\nX-Injected: evil",
			}),
		).toThrow(CalendarValidationError)
	})
})

describe("iCal utilities (RFC 5545 Section 3.1/3.3.11)", () => {
	it("formatDateUtc produces YYYYMMDDTHHMMSSZ", () => {
		expect(formatDateUtc(new Date("2025-06-15T09:30:00Z"))).toBe("20250615T093000Z")
	})

	it("escapeIcalText escapes backslash, semicolon, comma, newline", () => {
		expect(escapeIcalText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne")
	})

	it("foldIcalLine folds at 75 bytes", () => {
		const long = `DESCRIPTION:${"A".repeat(100)}`
		const folded = foldIcalLine(long)
		for (const line of folded.split("\r\n")) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
		}
	})

	it("foldIcalLine does not split multi-byte UTF-8 chars", () => {
		const long = `SUMMARY:${"あ".repeat(30)}`
		const folded = foldIcalLine(long)
		for (const line of folded.split("\r\n")) {
			expect(line).not.toMatch(/[\x80-\xBF]$/)
		}
	})
})

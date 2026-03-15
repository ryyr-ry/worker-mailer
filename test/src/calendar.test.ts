import { describe, expect, it } from "vitest"
import {
	type CalendarEventOptions,
	createCalendarEvent,
	escapeIcalText,
	foldIcalLine,
	formatDateUtc,
} from "../../src/calendar"
import { Email } from "../../src/email/email"

function baseOptions(overrides?: Partial<CalendarEventOptions>): CalendarEventOptions {
	return {
		summary: "Team Meeting",
		start: new Date("2025-03-15T10:00:00Z"),
		end: new Date("2025-03-15T11:00:00Z"),
		organizer: { name: "Alice", email: "alice@example.com" },
		uid: "test-uid-123",
		...overrides,
	}
}

describe("Calendar invites", () => {
	describe("createCalendarEvent", () => {
		it("generates iCalendar string for basic event", () => {
			const result = createCalendarEvent(baseOptions())
			expect(result.content).toContain("BEGIN:VCALENDAR")
			expect(result.content).toContain("END:VCALENDAR")
			expect(result.content).toContain("BEGIN:VEVENT")
			expect(result.content).toContain("END:VEVENT")
			expect(result.content).toContain("VERSION:2.0")
			expect(result.content).toContain("PRODID:-//worker-mailer//NONSGML v1.0//EN")
			expect(result.method).toBe("REQUEST")
		})

		it("DTSTART/DTEND in UTC format", () => {
			const result = createCalendarEvent(baseOptions())
			expect(result.content).toContain("DTSTART:20250315T100000Z")
			expect(result.content).toContain("DTEND:20250315T110000Z")
		})

		it("ORGANIZER with CN", () => {
			const result = createCalendarEvent(baseOptions())
			expect(result.content).toContain("ORGANIZER;CN=Alice:mailto:alice@example.com")
		})

		it("ORGANIZER without CN when name is absent", () => {
			const result = createCalendarEvent(baseOptions({ organizer: { email: "bob@example.com" } }))
			expect(result.content).toContain("ORGANIZER:mailto:bob@example.com")
			expect(result.content).not.toContain("CN=")
		})

		it("outputs multiple ATTENDEEs", () => {
			const result = createCalendarEvent(
				baseOptions({
					attendees: [
						{ name: "Bob", email: "bob@example.com" },
						{ name: "Carol", email: "carol@example.com" },
					],
				}),
			)
			expect(result.content).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CN=Bob")
			expect(result.content).toContain(":mailto:bob@example.com")
			expect(result.content).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CN=Carol")
			expect(result.content).toContain(":mailto:carol@example.com")
		})

		it("RSVP defaults to TRUE", () => {
			const result = createCalendarEvent(
				baseOptions({
					attendees: [{ email: "bob@example.com" }],
				}),
			)
			expect(result.content).toContain("RSVP=TRUE")
		})

		it("RSVP can be set to FALSE", () => {
			const result = createCalendarEvent(
				baseOptions({
					attendees: [{ email: "bob@example.com", rsvp: false }],
				}),
			)
			expect(result.content).toContain("RSVP=FALSE")
		})

		it("outputs LOCATION", () => {
			const result = createCalendarEvent(baseOptions({ location: "Conference Room A" }))
			expect(result.content).toContain("LOCATION:Conference Room A")
		})

		it("outputs DESCRIPTION", () => {
			const result = createCalendarEvent(baseOptions({ description: "Weekly sync" }))
			expect(result.content).toContain("DESCRIPTION:Weekly sync")
		})

		it("outputs URL", () => {
			const result = createCalendarEvent(baseOptions({ url: "https://meet.example.com/abc" }))
			expect(result.content).toContain("URL:https://meet.example.com/abc")
		})

		it("outputs VALARM reminder", () => {
			const result = createCalendarEvent(baseOptions({ reminderMinutes: 15 }))
			expect(result.content).toContain("BEGIN:VALARM")
			expect(result.content).toContain("ACTION:DISPLAY")
			expect(result.content).toContain("TRIGGER:-PT15M")
			expect(result.content).toContain("END:VALARM")
		})

		it("auto-generates UID", () => {
			const result = createCalendarEvent(baseOptions({ uid: undefined }))
			expect(result.content).toMatch(/UID:[a-f0-9-]+/)
		})

		it("uses specified UID", () => {
			const result = createCalendarEvent(baseOptions({ uid: "custom-uid-999" }))
			expect(result.content).toContain("UID:custom-uid-999")
		})

		it("reflects METHOD: CANCEL", () => {
			const result = createCalendarEvent(baseOptions({ method: "CANCEL" }))
			expect(result.content).toContain("METHOD:CANCEL")
			expect(result.method).toBe("CANCEL")
		})

		it("escapes special characters", () => {
			expect(escapeIcalText("hello;world")).toBe("hello\\;world")
			expect(escapeIcalText("a,b")).toBe("a\\,b")
			expect(escapeIcalText("line1\nline2")).toBe("line1\\nline2")
			expect(escapeIcalText("back\\slash")).toBe("back\\\\slash")
		})

		it("folds lines exceeding 75 octets", () => {
			const longLine = `DESCRIPTION:${"A".repeat(100)}`
			const folded = foldIcalLine(longLine)
			const foldedLines = folded.split("\r\n")
			expect(foldedLines.length).toBeGreaterThan(1)

			const encoder = new TextEncoder()
			for (let i = 0; i < foldedLines.length; i++) {
				const byteLen = encoder.encode(foldedLines[i]).length
				expect(byteLen).toBeLessThanOrEqual(75)
			}
		})

		it("throws on start >= end", () => {
			const sameTime = new Date("2025-03-15T10:00:00Z")
			expect(() => createCalendarEvent(baseOptions({ start: sameTime, end: sameTime }))).toThrow(
				"[Calendar] start must be before end",
			)

			const reversed = {
				start: new Date("2025-03-15T11:00:00Z"),
				end: new Date("2025-03-15T10:00:00Z"),
			}
			expect(() => createCalendarEvent(baseOptions(reversed))).toThrow(
				"[Calendar] start must be before end",
			)
		})

		it("throws on empty summary", () => {
			expect(() => createCalendarEvent(baseOptions({ summary: "   " }))).toThrow(
				"[Calendar] summary must not be empty",
			)
		})
	})

	describe("formatDateUtc", () => {
		it("formats date correctly", () => {
			const date = new Date("2025-01-02T03:04:05Z")
			expect(formatDateUtc(date)).toBe("20250102T030405Z")
		})
	})

	describe("MIME integration", () => {
		it("text + html + calendar stored in multipart/alternative", () => {
			const calResult = createCalendarEvent(baseOptions())
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Meeting Invite",
				text: "You are invited",
				html: "<p>You are invited</p>",
				calendarEvent: calResult,
			})
			const raw = email.getRawMessage()
			expect(raw).toContain("multipart/alternative")
			expect(raw).toContain("text/plain")
			expect(raw).toContain("text/html")
			expect(raw).toContain("text/calendar")
		})

		it("Content-Type includes text/calendar; method=REQUEST", () => {
			const calResult = createCalendarEvent(baseOptions())
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Meeting Invite",
				text: "You are invited",
				html: "<p>You are invited</p>",
				calendarEvent: calResult,
			})
			const raw = email.getRawMessage()
			expect(raw).toContain('text/calendar; charset="UTF-8"; method=REQUEST')
		})
	})
})

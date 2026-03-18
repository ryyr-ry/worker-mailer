import { describe, expect, it } from "vitest"
import {
CalendarValidationError,
ConfigurationError,
CrlfInjectionError,
DkimError,
EmailValidationError,
QueueClosedError,
SmtpAuthError,
SmtpCommandError,
SmtpConnectionError,
WorkerMailerError,
} from "../../src/errors"

describe("Error hierarchy", () => {
const subclasses = [
{ Class: CrlfInjectionError, args: ["header value"] },
{ Class: EmailValidationError, args: ["invalid email"] },
{ Class: SmtpAuthError, args: ["auth failed"] },
{ Class: SmtpCommandError, args: ["MAIL FROM", "550 rejected"] },
{ Class: SmtpConnectionError, args: ["connection refused"] },
{ Class: ConfigurationError, args: ["bad config"] },
{ Class: DkimError, args: ["signing failed"] },
{ Class: CalendarValidationError, args: ["invalid event"] },
{ Class: QueueClosedError, args: [] },
] as const

it("WorkerMailerError extends Error", () => {
const err = new WorkerMailerError("test")
expect(err).toBeInstanceOf(Error)
expect(err).toBeInstanceOf(WorkerMailerError)
expect(err.name).toBe("WorkerMailerError")
expect(err.message).toBe("test")
})

it("each subclass preserves name and message and extends WorkerMailerError", () => {
for (const { Class, args } of subclasses) {
const err = new (Class as new (...a: string[]) => WorkerMailerError)(...args)
expect(err).toBeInstanceOf(Error)
expect(err).toBeInstanceOf(WorkerMailerError)
expect(err.name).toBe(Class.name)
expect(err.message).toBeTruthy()
}
})

it("SmtpCommandError preserves command and response properties", () => {
const err = new SmtpCommandError("RCPT TO", "550 5.1.1 user unknown")
expect(err.command).toBe("RCPT TO")
expect(err.response).toBe("550 5.1.1 user unknown")
expect(err.message).toContain("RCPT TO")
expect(err.message).toContain("550 5.1.1 user unknown")
})

it("catch-by-type enables granular error handling", () => {
const errors: WorkerMailerError[] = [
new CrlfInjectionError("from"),
new SmtpAuthError("bad credentials"),
new SmtpConnectionError("timeout"),
]

let crlfCaught = false
let authCaught = false
let connCaught = false

for (const err of errors) {
if (err instanceof CrlfInjectionError) crlfCaught = true
else if (err instanceof SmtpAuthError) authCaught = true
else if (err instanceof SmtpConnectionError) connCaught = true
}

expect(crlfCaught).toBe(true)
expect(authCaught).toBe(true)
expect(connCaught).toBe(true)
})

it("errors are JSON-serializable without data loss", () => {
const err = new SmtpCommandError("DATA", "451 try later")
const json = JSON.parse(JSON.stringify(err))
expect(json.command).toBe("DATA")
expect(json.response).toBe("451 try later")
})
})

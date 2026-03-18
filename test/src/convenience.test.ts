import { describe, expect, it } from "vitest"
import { fromEnv } from "../../src/convenience/env"
import { preset } from "../../src/convenience/preset"
import { ConfigurationError } from "../../src/errors"

describe("fromEnv", () => {
const validEnv = { SMTP_HOST: "mail.test.com", SMTP_PORT: "587", SMTP_USER: "u", SMTP_PASS: "p" }

it("parses standard SMTP_* environment variables", () => {
const opts = fromEnv(validEnv)
expect(opts.host).toBe("mail.test.com")
expect(opts.port).toBe(587)
expect(opts.username).toBe("u")
expect(opts.password).toBe("p")
})

it("custom prefix reads prefixed variables", () => {
const env = { MAIL_HOST: "h.com", MAIL_PORT: "25" }
const opts = fromEnv(env, "MAIL_")
expect(opts.host).toBe("h.com")
})

it("missing SMTP_HOST throws ConfigurationError", () => {
expect(() => fromEnv({ SMTP_PORT: "25" })).toThrow(ConfigurationError)
})

it("missing SMTP_PORT throws ConfigurationError", () => {
expect(() => fromEnv({ SMTP_HOST: "h.com" })).toThrow(ConfigurationError)
})

it("invalid port (non-numeric) throws ConfigurationError", () => {
expect(() => fromEnv({ SMTP_HOST: "h.com", SMTP_PORT: "abc" })).toThrow(ConfigurationError)
})

it("port out of range throws ConfigurationError", () => {
expect(() => fromEnv({ SMTP_HOST: "h.com", SMTP_PORT: "0" })).toThrow(ConfigurationError)
expect(() => fromEnv({ SMTP_HOST: "h.com", SMTP_PORT: "99999" })).toThrow(ConfigurationError)
})

it("SMTP_SECURE=true sets secure option", () => {
const opts = fromEnv({ ...validEnv, SMTP_SECURE: "true" })
expect(opts.secure).toBe(true)
})

it("SMTP_START_TLS=true sets startTls option", () => {
const opts = fromEnv({ ...validEnv, SMTP_START_TLS: "true" })
expect(opts.startTls).toBe(true)
})

it("SMTP_DKIM_* sets dkim options", () => {
const env = {
...validEnv,
SMTP_DKIM_DOMAIN: "d.com",
SMTP_DKIM_SELECTOR: "s1",
SMTP_DKIM_PRIVATE_KEY: "key",
}
const opts = fromEnv(env)
expect(opts.dkim).toBeDefined()
expect(opts.dkim?.domainName).toBe("d.com")
})

it("no credentials: username/password omitted", () => {
const env = { SMTP_HOST: "h.com", SMTP_PORT: "25" }
const opts = fromEnv(env)
expect(opts.username).toBeUndefined()
expect(opts.password).toBeUndefined()
})
})

describe("preset", () => {
it("gmail returns smtp.gmail.com config", () => {
const opts = preset("gmail", {})
expect(opts.host).toBe("smtp.gmail.com")
expect(opts.port).toBe(587)
expect(opts.startTls).toBe(true)
})

it("outlook returns smtp.office365.com config", () => {
const opts = preset("outlook", {})
expect(opts.host).toBe("smtp.office365.com")
})

it("sendgrid returns smtp.sendgrid.net config", () => {
const opts = preset("sendgrid", {})
expect(opts.host).toBe("smtp.sendgrid.net")
})

it("preset picks up SMTP_USER/SMTP_PASS from env", () => {
const opts = preset("gmail", { SMTP_USER: "u", SMTP_PASS: "p" })
expect(opts.username).toBe("u")
expect(opts.password).toBe("p")
})
})

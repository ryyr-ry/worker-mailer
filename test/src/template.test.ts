import { describe, expect, it } from "vitest"
import { compile, render } from "../../src/template"

describe("Template engine", () => {
it("{{var}} substitutes value", () => {
expect(render("Hello {{name}}", { name: "World" })).toBe("Hello World")
})

it("{{var}} HTML-escapes output (XSS prevention)", () => {
expect(render("{{val}}", { val: "<script>alert(1)</script>" }))
.toBe("&lt;script&gt;alert(1)&lt;/script&gt;")
})

it("{{{var}}} does NOT HTML-escape (raw output)", () => {
expect(render("{{{val}}}", { val: "<b>bold</b>" })).toBe("<b>bold</b>")
})

it("{{#key}}...{{/key}} renders when truthy", () => {
expect(render("{{#show}}yes{{/show}}", { show: true })).toBe("yes")
})

it("{{#key}}...{{/key}} skipped when falsy", () => {
expect(render("{{#show}}yes{{/show}}", { show: false })).toBe("")
})

it("{{^key}}...{{/key}} renders when falsy (inverted section)", () => {
expect(render("{{^hidden}}visible{{/hidden}}", { hidden: false }))
.toBe("visible")
})

it("{{#array}}...{{/array}} iterates over items", () => {
expect(render("{{#items}}{{.}},{{/items}}", { items: ["a", "b"] }))
.toBe("a,b,")
})

it("{{obj.prop}} nested property access", () => {
expect(render("{{user.name}}", { user: { name: "Ada" } })).toBe("Ada")
})

it("missing variable renders empty string", () => {
expect(render("Hello {{missing}}", {})).toBe("Hello ")
})

it("compile returns reusable render function", () => {
const fn = compile("Hello {{name}}")
expect(fn({ name: "A" })).toBe("Hello A")
expect(fn({ name: "B" })).toBe("Hello B")
})

it("__proto__ access blocked (prototype pollution prevention)", () => {
expect(render("{{__proto__}}", {})).toBe("")
})

it("constructor access blocked (prototype pollution prevention)", () => {
expect(render("{{constructor}}", {})).toBe("")
})

it("<script> in {{var}} is HTML-escaped (XSS prevention)", () => {
expect(render("{{x}}", { x: "<script>" })).not.toContain("<script>")
})

it("{{#array}}...{{/array}} with empty array renders nothing", () => {
expect(render("{{#items}}x{{/items}}", { items: [] })).toBe("")
})

it("nested sections with same key render correctly", () => {
const template = "{{#items}}[{{#items}}inner{{/items}}]{{/items}}"
const result = render(template, { items: true })
expect(result).toBe("[inner]")
})

it("nested sections with array render correctly", () => {
const template = "{{#list}}({{#list}}nested{{/list}}){{/list}}"
const result = render(template, { list: [{ list: true }, { list: false }] })
expect(result).toBe("(nested)()")
})

it("deeply nested same-name sections", () => {
const template = "{{#a}}1{{#a}}2{{#a}}3{{/a}}2{{/a}}1{{/a}}"
const result = render(template, { a: true })
expect(result).toBe("12321")
})

it("inverted section inside regular section with same key", () => {
const template = "{{#show}}yes{{^show}}no{{/show}}{{/show}}"
// show=true: outer renders, inner inverted skips → "yes"
expect(render(template, { show: true })).toBe("yes")
// show=false: outer skips entirely → ""
expect(render(template, { show: false })).toBe("")
})
})

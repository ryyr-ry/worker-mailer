import { describe, expect, it } from "vitest"
import { htmlToText } from "../../src/html-to-text"

describe("HTML to text conversion", () => {
it("strips <script> tags and content (security)", () => {
expect(htmlToText("<p>Hi</p><script>alert('xss')</script>")).not.toContain("alert")
})

it("strips <style> tags and content", () => {
expect(htmlToText("<p>Hi</p><style>body{color:red}</style>")).not.toContain("color")
})

it("<p> becomes double newline", () => {
expect(htmlToText("<p>A</p><p>B</p>")).toContain("A\n\nB")
})

it("<br> becomes newline", () => {
expect(htmlToText("A<br>B")).toContain("A\nB")
})

it("<h1>-<h3> produce heading with newlines", () => {
const result = htmlToText("<h1>Title</h1><h2>Sub</h2>")
expect(result).toContain("Title")
expect(result).toContain("Sub")
})

it("<a href> preserves link when preserveLinks=true", () => {
const result = htmlToText('<a href="https://x.com">click</a>', { preserveLinks: true })
expect(result).toContain("https://x.com")
})

it("<a href> drops link when preserveLinks=false", () => {
const result = htmlToText('<a href="https://x.com">click</a>', { preserveLinks: false })
expect(result).not.toContain("https://x.com")
})

it("<ul><li> as bullet list with dash prefix", () => {
const result = htmlToText("<ul><li>A</li><li>B</li></ul>")
expect(result).toContain("- A")
expect(result).toContain("- B")
})

it("<ol><li> converted to list items", () => {
const result = htmlToText("<ol><li>A</li><li>B</li></ol>")
expect(result).toContain("A")
expect(result).toContain("B")
})

it("<hr> as separator", () => {
expect(htmlToText("<hr>")).toContain("---")
})

it("HTML entities decoded (&amp; &lt; &#x27;)", () => {
expect(htmlToText("&amp; &lt; &#x27;")).toBe("& < '")
})

it("numeric entities decoded (&#128512; emoji)", () => {
expect(htmlToText("&#128512;")).toBe("😀")
})

it("word wrapping at specified length with spaces", () => {
const words = Array.from({ length: 40 }, () => "word").join(" ")
const result = htmlToText(words, { wordwrap: 40 })
for (const line of result.split("\n")) {
if (line.trim()) expect(line.length).toBeLessThanOrEqual(45)
}
})

it("wordwrap=false disables wrapping", () => {
const words = Array.from({ length: 40 }, () => "word").join(" ")
const result = htmlToText(words, { wordwrap: false })
expect(result.split("\n").length).toBe(1)
})

it("deeply nested HTML does not crash", () => {
const deep = "<div>".repeat(100) + "text" + "</div>".repeat(100)
expect(() => htmlToText(deep)).not.toThrow()
})
})

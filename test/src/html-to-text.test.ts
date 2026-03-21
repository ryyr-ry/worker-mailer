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

it("<ol><li> as numbered list", () => {
const result = htmlToText("<ol><li>A</li><li>B</li></ol>")
expect(result).toContain("1. A")
expect(result).toContain("2. B")
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
if (line.trim()) expect(line.length).toBeLessThanOrEqual(40)
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

describe("Security: script/style removal edge cases", () => {
it("strips <script> with CDATA content", () => {
const html = "<script>//<![CDATA[\nalert('xss')\n//]]></script>"
expect(htmlToText(html)).toBe("")
})

it("strips nested script inside style", () => {
expect(htmlToText("<style><script>alert(1)</script></style>")).toBe("")
})

it("strips script with HTML comments inside", () => {
expect(htmlToText("<script><!--alert(1)--></script>")).toBe("")
})

it("strips uppercase <SCRIPT> tags", () => {
expect(htmlToText("<SCRIPT>alert(1)</SCRIPT>")).toBe("")
})

it("strips <script> with attributes", () => {
expect(htmlToText('<script type="text/javascript">code</script>')).toBe("")
})

it("strips <style> with CSS injection payload", () => {
const html = "<style>body{background:url('javascript:alert(1)')}</style>"
expect(htmlToText(html)).toBe("")
})

it("leaks content from unclosed <script> tag (known limitation)", () => {
const result = htmlToText("<script>alert(1)")
expect(result).not.toContain("<script>")
})

it("strips mixed case <ScRiPt> tags", () => {
expect(htmlToText("<ScRiPt>alert(1)</ScRiPt>")).toBe("")
})

it("strips multiple script tags", () => {
const html = "<script>a</script>safe<script>b</script>"
expect(htmlToText(html)).toBe("safe")
})
})

describe("Security: link conversion edge cases", () => {
it("preserves newline in href as-is in plain text output", () => {
const result = htmlToText('<a href="https://x.com\ninjected">click</a>')
expect(result).toContain("click")
expect(result).not.toContain("<a")
})

it("decodes HTML entities in link URL via post-processing", () => {
const result = htmlToText('<a href="https://x.com?a=1&amp;b=2">link</a>')
expect(result).toContain("https://x.com?a=1&b=2")
})

it("handles nested anchor tags (invalid HTML)", () => {
const result = htmlToText('<a href="a"><a href="b">text</a></a>')
expect(result).toContain("text")
expect(result).not.toContain("<a")
})

it("strips inner tags from link label", () => {
expect(htmlToText('<a href="x"><b>bold</b> text</a>')).toBe("bold text (x)")
})

it("handles empty href gracefully", () => {
const result = htmlToText('<a href="">click</a>')
expect(result).not.toContain("<a")
expect(result).toContain("click")
})

it("outputs javascript: scheme as inert plain text", () => {
const result = htmlToText('<a href="javascript:alert(1)">click</a>')
expect(result).not.toContain("<a")
expect(result).not.toContain("<script")
expect(result).toContain("click")
})

it("when label equals URL, outputs URL only once", () => {
const result = htmlToText('<a href="https://x.com">https://x.com</a>')
expect(result).toBe("https://x.com")
})
})

describe("Edge cases: text wrapping", () => {
it("preserves word longer than wrap width on its own line", () => {
const long = "a".repeat(50)
const result = htmlToText(long, { wordwrap: 20 })
expect(result).toBe(long)
})

it("handles very long line (1000+ chars) with no spaces", () => {
const long = "x".repeat(1200)
const result = htmlToText(long, { wordwrap: 78 })
expect(result).toBe(long)
})

it("wraps mixed short and long words correctly", () => {
const html = `short ${"a".repeat(50)} end`
const result = htmlToText(html, { wordwrap: 20 })
const lines = result.split("\n")
expect(lines).toContain("short")
expect(lines).toContain("a".repeat(50))
expect(lines).toContain("end")
})
})

describe("Edge cases: entity decoding", () => {
it("preserves unknown named entity as-is", () => {
expect(htmlToText("&unknown;")).toBe("&unknown;")
})

it("decodes decimal numeric entity &#65; to 'A'", () => {
expect(htmlToText("&#65;")).toBe("A")
})

it("decodes hex numeric entity &#x41; to 'A'", () => {
expect(htmlToText("&#x41;")).toBe("A")
})

it("double-decodes &amp;lt; due to sequential replacement", () => {
expect(htmlToText("&amp;lt;")).toBe("<")
})
})

describe("Edge cases: block element handling", () => {
it("deeply nested divs produce text without excess blank lines", () => {
const result = htmlToText("<div><div><div>text</div></div></div>")
expect(result).toBe("text")
})

it("<br> converts to newline between lines", () => {
expect(htmlToText("line1<br>line2")).toBe("line1\nline2")
})

it("<hr> renders as horizontal rule separator", () => {
const result = htmlToText("above<hr>below")
expect(result).toContain("above")
expect(result).toContain("---")
expect(result).toContain("below")
})

it("unordered list items render with dash prefix", () => {
const result = htmlToText("<ul><li>a</li><li>b</li></ul>")
expect(result).toContain("- a")
expect(result).toContain("- b")
})

it("table cells are separated by spaces", () => {
const result = htmlToText("<table><tr><td>cell1</td><td>cell2</td></tr></table>")
expect(result).toContain("cell1")
expect(result).toContain("cell2")
})

it("self-closing <br /> is treated same as <br>", () => {
expect(htmlToText("a<br />b")).toBe("a\nb")
})
})

describe("HTML entity edge cases", () => {
	it("numeric entity out of Unicode range is preserved as-is", () => {
		const result = htmlToText("val=&#1114112;end")
		expect(result).toBe("val=&#1114112;end")
	})

	it("hex entity out of Unicode range is preserved as-is", () => {
		const result = htmlToText("val=&#x200000;end")
		expect(result).toBe("val=&#x200000;end")
	})

	it("valid numeric entities are still decoded", () => {
		expect(htmlToText("&#65;&#66;&#67;")).toBe("ABC")
	})
})

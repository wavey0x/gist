import assert from "node:assert/strict";
import test from "node:test";
import {
  codeLinesHtml,
  fileSlugs,
  formatLineFragment,
  parseLineFragment,
  splitHighlightedLines
} from "../public/code-lines.mjs";

const text = (html) => html.replace(/<[^>]*>/g, "");
const highlighted = (inner) => `<div class="highlight highlight-source-python" dir="auto"><pre>${inner}</pre></div>`;

test("splits a highlighted block into lines and keeps the text exact", () => {
  const inner = '<span class="pl-k">def</span> total(values):\n    <span class="pl-k">return</span> 1 &lt; 2 &amp;&amp; x\n';
  const split = splitHighlightedLines(highlighted(inner));
  assert.equal(split.wrapperClass, "highlight highlight-source-python");
  assert.equal(split.lines.length, 2);
  assert.equal(split.lines.map(text).join("\n") + "\n", text(inner));
});

test("a span that crosses line breaks is closed and reopened on every line", () => {
  const split = splitHighlightedLines(highlighted('x = <span class="pl-s">"""a\nb\nc"""</span> + 1'));
  assert.deepEqual(split.lines, [
    'x = <span class="pl-s">"""a</span>',
    '<span class="pl-s">b</span>',
    '<span class="pl-s">c"""</span> + 1'
  ]);
});

test("nested spans reopen in order", () => {
  const split = splitHighlightedLines(highlighted('<span class="a"><span class="b">1\n2</span></span>'));
  assert.deepEqual(split.lines, [
    '<span class="a"><span class="b">1</span></span>',
    '<span class="a"><span class="b">2</span></span>'
  ]);
});

test("empty lines are kept and a trailing newline adds none", () => {
  assert.deepEqual(splitHighlightedLines(highlighted("a\n\nb\n")).lines, ["a", "", "b"]);
  assert.deepEqual(splitHighlightedLines(highlighted("a\n\n")).lines, ["a", ""]);
  assert.deepEqual(splitHighlightedLines(highlighted("")).lines, [""]);
});

test("the plain shape is split too", () => {
  const split = splitHighlightedLines('<pre><code class="language-text">one\ntwo</code></pre>');
  assert.equal(split.wrapperClass, "");
  assert.deepEqual(split.lines, ["one", "two"]);
});

test("anything unexpected is refused", () => {
  assert.equal(splitHighlightedLines("<p>prose</p>"), null);
  assert.equal(splitHighlightedLines(highlighted('a <a href="#x">link</a>')), null);
  assert.equal(splitHighlightedLines(highlighted("a</span>")), null);
  assert.equal(splitHighlightedLines(highlighted('<span class="a">open')), null);
  assert.equal(splitHighlightedLines(undefined), null);
});

test("line HTML carries ids, numbers and the digit count", () => {
  const html = codeLinesHtml(highlighted("a\nb"), "calc-py");
  assert.match(html, /<pre class="code-lines" data-line-prefix="file-calc-py-" data-line-slug="calc-py" style="--line-digits:1">/);
  assert.match(html, /<span class="code-line" id="file-calc-py-L2"><span class="code-line-number" data-line="2"><\/span>b\n<\/span>/);
  assert.match(codeLinesHtml(highlighted("a"), ""), /id="L1"/);
  assert.equal(codeLinesHtml("<p>prose</p>"), null);
});

test("fragments parse and format", () => {
  assert.deepEqual(parseLineFragment("#L24"), { slug: null, start: 24, end: 24 });
  assert.deepEqual(parseLineFragment("#L24-L31"), { slug: null, start: 24, end: 31 });
  assert.deepEqual(parseLineFragment("#L31-L24"), { slug: null, start: 24, end: 31 });
  assert.deepEqual(parseLineFragment("#file-borrowfreeze-vy-L24-L31"), { slug: "borrowfreeze-vy", start: 24, end: 31 });
  assert.deepEqual(parseLineFragment("#file-calc-py"), { slug: "calc-py", start: null, end: null });
  for (const junk of ["", "#", "#L0", "#L", "#l24", "#L24-", "#heading", "#L24-L31-L40", "#L99999999"]) {
    assert.equal(parseLineFragment(junk), null, junk);
  }
  assert.equal(formatLineFragment({ slug: null, start: 24, end: 24 }), "#L24");
  assert.equal(formatLineFragment({ slug: null, start: 24, end: 31 }), "#L24-L31");
  assert.equal(formatLineFragment({ slug: "calc-py", start: 3, end: 5 }), "#file-calc-py-L3-L5");
  assert.equal(formatLineFragment({ slug: "calc-py" }), "#file-calc-py");
});

test("file slugs follow GitHub Gist and stay unique", () => {
  assert.deepEqual(fileSlugs(["BorrowFreeze.vy", "data sample.json", "a.b.py", "a-b.py", "..."]), {
    "BorrowFreeze.vy": "borrowfreeze-vy",
    "data sample.json": "data-sample-json",
    "a.b.py": "a-b-py",
    "a-b.py": "a-b-py-1",
    "...": "file"
  });
});

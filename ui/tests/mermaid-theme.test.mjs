import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import mermaid from "mermaid";
import ts from "typescript";

// Use the application's configuration with the installed Mermaid parser.
const source = await readFile(
  new URL("../lib/mermaid-config.ts", import.meta.url),
  "utf8"
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext }
});
const { mermaidConfig } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const diagrams = {
  directive:
    '%%{init: {"theme":"base","themeVariables":{"lineColor":"#000000"}}}%%\nflowchart TD\nA --> B',
  frontmatter:
    '---\nconfig:\n  theme: base\n  themeVariables:\n    lineColor: "#000000"\n---\nflowchart TD\nA --> B'
};

for (const [syntax, diagram] of Object.entries(diagrams)) {
  test(`${syntax} cannot replace the reader theme or connector palette`, async () => {
    // Reinitializing in both directions models theme switches with existing source.
    for (const theme of ["dark", "default", "dark"]) {
      mermaid.initialize(mermaidConfig(theme));
      const expectedLineColor = mermaid.mermaidAPI.getConfig().themeVariables.lineColor;
      await mermaid.parse(diagram);
      const actual = mermaid.mermaidAPI.getConfig();
      assert.equal(actual.theme, theme);
      assert.equal(actual.themeVariables.lineColor, expectedLineColor);
      assert.equal(actual.securityLevel, "strict");
    }
  });
}

test("explicit edge and node styles survive both page themes", async () => {
  const diagram = `flowchart TD
    A colored@--> B
    B --> C
    linkStyle 1 stroke:#ef4444,stroke-width:3px
    classDef special stroke:#22c55e
    class colored special
    classDef position fill:#ede9fe,stroke:#7c3aed,color:#3b1764
    class A position`;

  for (const theme of ["dark", "default"]) {
    mermaid.initialize(mermaidConfig(theme));
    const { db } = await mermaid.mermaidAPI.getDiagramFromText(diagram);
    assert.deepEqual(db.getEdges()[0].classes, ["special"]);
    assert.ok(db.getClasses().get("special").styles.includes("stroke:#22c55e"));
    assert.ok(db.getEdges()[1].style.includes("stroke:#ef4444"));
    assert.deepEqual(db.getVertices().get("A").classes, ["position"]);
    assert.deepEqual(db.getClasses().get("position").styles, [
      "fill:#ede9fe", "stroke:#7c3aed", "color:#3b1764"
    ]);
  }
});

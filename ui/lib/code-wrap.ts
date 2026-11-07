export function addMarkdownWrapControls(root: Element) {
  const blocks = root.querySelectorAll<HTMLElement>("article.markdown-body pre");
  let number = 0;

  for (const pre of blocks) {
    if (pre.closest(".code-wrap-block, .mermaid-render, .math-display")) continue;
    const code = pre.parentElement?.classList.contains("highlight")
      ? pre.parentElement
      : pre;
    if (!code) continue;

    const shell = document.createElement("div");
    shell.className = "code-wrap-block";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-wrap-button";
    button.textContent = "Wrap";
    button.setAttribute("aria-label", `Wrap lines in code block ${++number}`);
    button.setAttribute("aria-pressed", "false");
    button.title = "Wrap code lines";
    button.addEventListener("click", () => {
      const wrapped = shell.classList.toggle("code-lines-wrapped");
      button.setAttribute("aria-pressed", String(wrapped));
      button.title = wrapped ? "Stop wrapping code lines" : "Wrap code lines";
    });

    code.replaceWith(shell);
    shell.append(code, button);
  }
}

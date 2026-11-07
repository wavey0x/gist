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
    button.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16-3 3 3 3"/><path d="M3 12h14.5a1 1 0 0 1 0 7H13"/><path d="M3 19h6"/><path d="M3 5h18"/></svg>';
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

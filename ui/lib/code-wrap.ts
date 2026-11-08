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

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "code-copy-button";
    copy.setAttribute("aria-label", `Copy code block ${number}`);
    copy.title = "Copy code";
    const svg = (path: string) => `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const copyIcon = svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
    copy.innerHTML = copyIcon;
    const status = document.createElement("span");
    status.className = "code-copy-status";
    status.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "code-block-actions";
    let timer: ReturnType<typeof setTimeout>;
    let attempt = 0;
    copy.addEventListener("click", async () => {
      const current = ++attempt;
      clearTimeout(timer);
      let message: string;
      try {
        await navigator.clipboard.writeText(pre.textContent || "");
        message = "Copied";
      } catch {
        message = "Couldn’t copy. Select the code and copy manually.";
      }
      if (current !== attempt || !copy.isConnected) return;
      copy.innerHTML = message === "Copied" ? svg('<path d="m5 12 4 4L19 6"/>') : copyIcon;
      copy.title = status.textContent = message;
      actions.dataset.feedback = "true";
      timer = setTimeout(() => {
        copy.innerHTML = copyIcon;
        copy.title = "Copy code";
        status.textContent = "";
        delete actions.dataset.feedback;
      }, message === "Copied" ? 1500 : 4000);
    });
    actions.append(button, copy, status);
    code.replaceWith(shell);
    shell.append(code, actions);
  }
}

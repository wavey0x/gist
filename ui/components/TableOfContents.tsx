"use client";

import { ListTree } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Heading = {
  id: string;
  text: string;
  level: number;
};

const MIN_HEADINGS = 3;

export function TableOfContents({ html }: { html: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [open, setOpen] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const controlRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const found = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".gist-single-file .markdown-body :is(h2, h3)[id]"
      )
    ).map((element) => ({
      id: element.id,
      text: element.textContent?.trim() ?? "",
      level: element.tagName === "H3" ? 3 : 2
    }));
    setHeadings(found.filter((heading) => heading.text));
  }, [html]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const position = window.scrollY + 80;
    const passed = headings.filter((heading) => {
      const element = document.getElementById(heading.id);
      return element && element.getBoundingClientRect().top + window.scrollY <= position;
    });
    setCurrentId(passed.at(-1)?.id ?? null);

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [headings, open]);

  if (headings.length < MIN_HEADINGS) {
    return null;
  }

  return (
    <div className="history-control" ref={controlRef}>
      <button
        type="button"
        className="icon-button"
        aria-label="Table of contents"
        aria-expanded={open}
        aria-controls="table-of-contents"
        title="Contents"
        onClick={() => setOpen((current) => !current)}
      >
        <ListTree aria-hidden="true" size={18} strokeWidth={1.8} />
      </button>
      {open ? (
        <nav
          id="table-of-contents"
          className="history-menu table-of-contents"
          aria-label="Table of contents"
        >
          {headings.map((heading) => (
            <a
              key={heading.id}
              className={`toc-item toc-item-${heading.level}`}
              href={`#${heading.id}`}
              aria-current={heading.id === currentId ? "location" : undefined}
              onClick={() => setOpen(false)}
            >
              {heading.text}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

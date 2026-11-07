"use client";

type Props = {
  wrapped: boolean;
  onToggle: () => void;
  className?: string;
  label?: string;
};

export function CodeWrapToggle({
  wrapped,
  onToggle,
  className = "code-wrap-button",
  label = "Wrap code lines"
}: Props) {
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={wrapped}
      title={wrapped ? "Stop wrapping code lines" : "Wrap code lines"}
      onClick={onToggle}
    >
      Wrap
    </button>
  );
}

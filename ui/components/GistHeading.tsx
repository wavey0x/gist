"use client";

import { useState, type ReactNode } from "react";
import { getGistHeaderTitle } from "../lib/gist-title";
import type { PublicGistPayload } from "../lib/gists";
import { LocalTimestamp } from "./LocalTimestamp";

const GITHUB_LOGIN_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function fallbackAuthorAvatarUrl(authorName: string) {
  return GITHUB_LOGIN_RE.test(authorName)
    ? `https://github.com/${authorName}.png?size=64`
    : null;
}

function authorAvatarInitial(authorName: string) {
  return authorName.trim().charAt(0).toUpperCase() || "?";
}

function latestRevisionCreatedAt(gist: PublicGistPayload) {
  return gist.history.find((item) => item.is_latest)?.created_at ?? gist.updated_at;
}

export function GistHeading({ gist, children }: { gist: PublicGistPayload; children?: ReactNode }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const headerTitle = getGistHeaderTitle(gist);
  const avatarUrl =
    gist.author_avatar_url ?? fallbackAuthorAvatarUrl(gist.author_name);
  const visibleAvatarUrl =
    avatarUrl && avatarUrl !== failedAvatarUrl ? avatarUrl : null;
  const lastEditedAt =
    gist.latest_revision_number > 1 ? latestRevisionCreatedAt(gist) : null;
  const dateTooltipRows = lastEditedAt
    ? [
        { label: "created", value: gist.created_at },
        { label: "edited", value: lastEditedAt }
      ]
    : [{ label: "created", value: gist.created_at }];
  const dateTooltip = (
    <span className="gist-date-tooltip" aria-hidden="true">
      {dateTooltipRows.map((row) => (
        <span className="gist-date-tooltip-row" key={row.label}>
          {row.label}: <LocalTimestamp value={row.value} />
        </span>
      ))}
    </span>
  );
  return (
    <div className="gist-heading">
      {children}
      {headerTitle ? <h1 className="gist-title">{headerTitle}</h1> : null}
      <div className="gist-meta">
        <div className="gist-date-row">
          <span className="gist-date-line gist-date-line-with-tooltip">
            <span className="gist-date-label">
              {lastEditedAt ? "edited:" : "created:"}
            </span>{" "}
            <span className="gist-date-desktop">
              <LocalTimestamp value={lastEditedAt ?? gist.created_at} />
            </span>
            <span className="gist-date-mobile">
              <LocalTimestamp
                value={lastEditedAt ?? gist.created_at}
                variant="short"
              />
            </span>
            {dateTooltip}
          </span>
        </div>
        <div className="gist-author-row">
          <span className="gist-author-line">
            {visibleAvatarUrl ? (
              <img
                className="gist-author-avatar"
                src={visibleAvatarUrl}
                alt=""
                width={18}
                height={18}
                onError={() => setFailedAvatarUrl(visibleAvatarUrl)}
              />
            ) : (
              <span
                className="gist-author-avatar gist-author-avatar-placeholder"
                aria-hidden="true"
              >
                {authorAvatarInitial(gist.author_name)}
              </span>
            )}
            by <span className="gist-author-name">{gist.author_name}</span>
          </span>
          {gist.revision_number < gist.latest_revision_number ? (
            <a
              className="gist-revision-notice"
              href={`/${gist.id}`}
              onClick={(event) => {
                // Keep a line link's lines when moving to the latest revision.
                event.currentTarget.href = `/${gist.id}${window.location.hash}`;
              }}
            >
              Revision {gist.revision_number} · view latest
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

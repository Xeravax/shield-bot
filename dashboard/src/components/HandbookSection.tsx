import type { ReactNode } from "react";
import { openExternalLink } from "../discord";
import { HANDBOOK_LINKS } from "../api";
import type { DashboardUser } from "../api";

interface Props {
  user: DashboardUser;
}

export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="link-btn"
      onClick={() => void openExternalLink(href)}
    >
      <span>{children}</span>
      <span className="arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}

export function HandbookSection({ user }: Props) {
  if (!user.shieldMember) {
    return (
      <section className="dossier resources-panel">
        <div className="dossier-head">
          <div>
            <h2>Dossier</h2>
            <p>Handbooks unlock at Recruit+.</p>
          </div>
        </div>
        <div className="notice">
          Custom SHIELD avatars fall under specific rules and may only be used
          at Deputy rank and above — representing SHIELD with your own avatar
          carries responsibilities with it.
        </div>
      </section>
    );
  }

  return (
    <section className="dossier resources-panel">
      <div className="dossier-head">
        <div>
          <h2>Handbooks</h2>
          <p>Open guides outside Discord.</p>
        </div>
      </div>
      <div className="resource-grid">
        <ExternalLink href={HANDBOOK_LINKS.fullHandbook}>
          Full SHIELD Handbook
        </ExternalLink>
        <ExternalLink href={HANDBOOK_LINKS.phantomPain}>
          Phantom Pain List
        </ExternalLink>
        {user.deputy ? (
          <ExternalLink href={HANDBOOK_LINKS.avatarGuidelines}>
            2026 Avatar Guidelines
          </ExternalLink>
        ) : (
          <div className="notice">
            Custom SHIELD avatars may only be used at Deputy+. Representing
            SHIELD with a personal avatar carries responsibilities.
          </div>
        )}
      </div>
    </section>
  );
}

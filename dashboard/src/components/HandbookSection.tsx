import type { ReactNode } from "react";
import { openExternalLink } from "../discord";
import { SITE_LINKS, type DashboardUser } from "../api";
import {
  generalHandbooks,
  handbookGroups,
  handbookRef,
  type HandbookGroup,
} from "../handbooks";

export function ExternalLink({
  href,
  children,
  reference,
}: {
  href: string;
  children: ReactNode;
  /** Small typed file reference shown under the title. */
  reference?: string;
}) {
  return (
    <button
      type="button"
      className="link-btn"
      onClick={() => void openExternalLink(href)}
    >
      <span className="link-btn-text">
        <span>{children}</span>
        {reference && <span className="link-btn-ref">{reference}</span>}
      </span>
      <span className="arrow" aria-hidden="true">
        ↗
      </span>
    </button>
  );
}

function MembersOnlyNotice() {
  return (
    <div className="notice">
      Handbooks unlock at Recruit+. Custom SHIELD avatars fall under specific
      rules and may only be used at Deputy rank and above — representing SHIELD
      with your own avatar carries responsibilities with it.
    </div>
  );
}

function GroupLinks({ group }: { group: HandbookGroup }) {
  return (
    <>
      <div className="resource-grid">
        {group.entries.map((e) => (
          <ExternalLink key={e.href} href={e.href} reference={handbookRef(e.href)}>
            {e.title}
          </ExternalLink>
        ))}
      </div>
      {group.lockedNote && <div className="notice">{group.lockedNote}</div>}
    </>
  );
}

/** Overview column: the everyday handbooks plus a jump to the full library. */
export function HandbookSection({
  user,
  onOpenLibrary,
}: {
  user: DashboardUser;
  onOpenLibrary?: () => void;
}) {
  if (!user.shieldMember) {
    return (
      <section className="dossier resources-panel">
        <div className="dossier-head">
          <div>
            <h2>Handbooks</h2>
            <p>Filed for members only.</p>
          </div>
        </div>
        <MembersOnlyNotice />
      </section>
    );
  }

  const total = handbookGroups(user).reduce(
    (sum, g) => sum + g.entries.length,
    0,
  );

  return (
    <section className="dossier resources-panel">
      <div className="dossier-head">
        <div>
          <h2>Handbooks</h2>
          <p>Everyday references — open outside Discord.</p>
        </div>
      </div>
      <GroupLinks group={generalHandbooks(user)} />
      {onOpenLibrary && (
        <button type="button" className="library-jump" onClick={onOpenLibrary}>
          <span>Open handbook library</span>
          <span className="library-jump-count">{total} filed</span>
        </button>
      )}
    </section>
  );
}

/** Handbooks tab: every handbook the user's roles unlock, grouped by desk. */
export function HandbookLibrary({ user }: { user: DashboardUser }) {
  const groups = handbookGroups(user);

  return (
    <div className="panel handbook-library">
      {groups.length === 0 ? (
        <section className="dossier">
          <div className="dossier-head">
            <div>
              <h2>Handbook library</h2>
              <p>Nothing filed under your name yet.</p>
            </div>
          </div>
          <MembersOnlyNotice />
        </section>
      ) : (
        <div className="library-groups">
          {groups.map((g) => (
            <section
              key={g.id}
              className={`dossier library-group library-${g.id}`}
              aria-labelledby={`library-${g.id}`}
            >
              <div className="dossier-head">
                <div>
                  <h2 id={`library-${g.id}`}>{g.title}</h2>
                </div>
                <span className="clearance-tag">{g.clearance}</span>
              </div>
              <GroupLinks group={g} />
            </section>
          ))}
        </div>
      )}

      <div className="library-footer">
        <ExternalLink href={SITE_LINKS.guides} reference="guides.vrcshield.com">
          Browse every guide on the SHIELD guides site
        </ExternalLink>
      </div>
    </div>
  );
}

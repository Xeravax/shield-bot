import type { DashboardUser } from "../api";

interface Props {
  user: DashboardUser;
  initials: string;
}

/** Compact presence shown when Discord puts the Activity in PIP or grid. */
export function PipPresence({ user, initials }: Props) {
  return (
    <div className="pip-presence" role="status" aria-label="SHIELD Dashboard is open">
      <div className="pip-presence-marks">
        <img className="pip-logo" src="/logo.png" alt="SHIELD" />
        <div className="pip-avatar">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="avatar-fallback">{initials}</div>
          )}
        </div>
      </div>
      <div className="pip-presence-copy">
        <p className="pip-kicker">S.H.I.E.L.D.</p>
        <p className="pip-title">Briefing</p>
        <p className="pip-user">{user.displayName}</p>
      </div>
    </div>
  );
}

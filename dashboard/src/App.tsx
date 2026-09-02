import { useCallback, useEffect, useState } from "react";
import { fetchMe, type DashboardUser } from "./api";
import { getAccessToken, initDevFallback, initDiscord } from "./discord";
import { MOCK_USER } from "./mockData";
import { AdminPanel } from "./components/AdminPanel";
import { CalendarPanel } from "./components/CalendarPanel";
import { HandbookSection } from "./components/HandbookSection";
import { HostPanel } from "./components/HostPanel";
import { HoursPanel } from "./components/HoursPanel";
import { PreviewNotice } from "./components/PreviewNotice";
import { TrainerPanel } from "./components/TrainerPanel";

type Tab = "home" | "admin" | "host" | "trainer";

const TAB_COPY: Record<Tab, { title: string; subtitle: string }> = {
  home: {
    title: "Command overview",
    subtitle: "Your patrol hours, upcoming events, and essential handbooks.",
  },
  admin: {
    title: "Staff console",
    subtitle: "Server health, hour adjustments, and moderation history.",
  },
  host: {
    title: "Event hosting",
    subtitle: "Schedule around collisions in your timezone.",
  },
  trainer: {
    title: "Trainer desk",
    subtitle: "Handbooks for your trainer assignments.",
  },
};

export default function App() {
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUser = useCallback(async (token: string) => {
    const me = await fetchMe(token);
    setUser(me);
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        const devToken = import.meta.env.VITE_DEV_ACCESS_TOKEN as
          | string
          | undefined;
        if (devToken) {
          await initDevFallback(devToken);
        } else {
          await initDiscord();
        }
        const token = getAccessToken();
        if (!token) {
          throw new Error("No access token");
        }
        await loadUser(token);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Failed to connect to Discord Activity",
        );
      } finally {
        setBooting(false);
      }
    }
    void boot();
  }, [loadUser]);

  const displayUser = user ?? MOCK_USER;
  const isAppPreview = booting || !user;
  const token = getAccessToken() ?? "";
  const initials = displayUser.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: "home", label: "Overview", show: true },
    { id: "admin", label: "Admin", show: displayUser.staff },
    { id: "host", label: "Host", show: displayUser.host },
    {
      id: "trainer",
      label: "Trainer",
      show: displayUser.trainerTypes.length > 0,
    },
  ];

  const visibleTabs = tabs.filter((t) => t.show);
  const copy = TAB_COPY[tab];

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">
            <img src="/logo.png" alt="SHIELD logo" />
            <div className="brand-copy">
              <p className="brand-kicker">S.H.I.E.L.D.</p>
              <h1>Dashboard</h1>
            </div>
          </div>

          <div className="profile-chip">
            {displayUser.avatarUrl ? (
              <img
                src={displayUser.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="avatar-fallback">{initials}</div>
            )}
            <div className="profile-meta">
              <strong>{displayUser.displayName}</strong>
              <span>@{displayUser.username}</span>
            </div>
          </div>
        </div>

        <nav className="topbar-nav" aria-label="Dashboard sections">
          {visibleTabs.map((t, index) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <span className="tab-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="workspace">
        {isAppPreview && (
          <PreviewNotice
            className="app-level"
            message={
              booting
                ? "Sample data — connecting to Discord…"
                : "Sample data — could not load your profile"
            }
          />
        )}

        {error && !booting && (
          <PreviewNotice className="app-level error" message={error} />
        )}

        <div className="workspace-top">
          <div>
            <h2>{copy.title}</h2>
            <p>{copy.subtitle}</p>
          </div>
          <div className="role-pills">
            <span className={`role-pill ${displayUser.shieldMember ? "on" : ""}`}>
              Recruit+
            </span>
            <span className={`role-pill ${displayUser.deputy ? "on" : ""}`}>
              Deputy+
            </span>
            {displayUser.staff && <span className="role-pill on">Staff</span>}
            {displayUser.host && <span className="role-pill on">Host</span>}
            {displayUser.trainerTypes.map((t) => (
              <span key={t} className="role-pill on">
                {t.toUpperCase()}
              </span>
            ))}
          </div>
        </div>

        <main className="app-main">
          {tab === "home" && (
            <div className="panel home-grid">
              <HoursPanel
                token={token}
                user={displayUser}
                preview={isAppPreview}
              />
              <CalendarPanel
                token={token}
                user={displayUser}
                preview={isAppPreview}
              />
              <HandbookSection user={displayUser} />
            </div>
          )}
          {tab === "admin" && displayUser.staff && (
            <AdminPanel token={token} preview={isAppPreview} />
          )}
          {tab === "host" && displayUser.host && (
            <HostPanel
              token={token}
              user={displayUser}
              preview={isAppPreview}
              onTimezoneSaved={(timezone) => {
                if (user) {
                  setUser({ ...user, timezone, timezoneStored: true });
                }
              }}
            />
          )}
          {tab === "trainer" && displayUser.trainerTypes.length > 0 && (
            <TrainerPanel user={displayUser} />
          )}
        </main>
      </div>
    </div>
  );
}

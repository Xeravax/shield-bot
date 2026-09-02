import { useCallback, useEffect, useState } from "react";
import { fetchMe, type DashboardUser } from "./api";
import {
  getAccessToken,
  getDiscordSdk,
  initDevFallback,
  initDiscord,
  isCompactLayout,
  LayoutMode,
  subscribeLayoutMode,
  type ActivityLayoutMode,
} from "./discord";
import { MOCK_USER } from "./mockData";
import { AdminPanel } from "./components/AdminPanel";
import { BootSplash, type BootSplashPhase } from "./components/BootSplash";
import { CalendarPanel } from "./components/CalendarPanel";
import { HandbookSection } from "./components/HandbookSection";
import { HostPanel } from "./components/HostPanel";
import { HoursPanel } from "./components/HoursPanel";
import { PipPresence } from "./components/PipPresence";
import { PreviewNotice } from "./components/PreviewNotice";
import { TrainerPanel } from "./components/TrainerPanel";

type Tab = "home" | "admin" | "host" | "trainer";

const MIN_BOOT_MS = 3000;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });
}

export default function App() {
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [splashPhase, setSplashPhase] = useState<BootSplashPhase>("loading");
  const [showApp, setShowApp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<ActivityLayoutMode>(
    LayoutMode.FOCUSED,
  );

  const loadUser = useCallback(async (token: string) => {
    const me = await fetchMe(token);
    setUser(me);
  }, []);

  const revealApp = useCallback(() => {
    setShowApp(true);
  }, []);

  useEffect(() => {
    async function boot() {
      const started = Date.now();
      try {
        const auth = (async () => {
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
        })();

        await Promise.all([auth, sleep(MIN_BOOT_MS - (Date.now() - started))]);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Failed to connect to Discord Activity",
        );
        const remaining = MIN_BOOT_MS - (Date.now() - started);
        if (remaining > 0) {
          await sleep(remaining);
        }
      } finally {
        setSplashPhase("finishing");
      }
    }
    void boot();
  }, [loadUser]);

  useEffect(() => {
    if (!showApp || !getDiscordSdk()) {
      return;
    }
    return subscribeLayoutMode(setLayoutMode);
  }, [showApp]);

  useEffect(() => {
    const compact = isCompactLayout(layoutMode);
    document.documentElement.classList.toggle("layout-pip", compact);
    document.body.classList.toggle("layout-pip", compact);
    return () => {
      document.documentElement.classList.remove("layout-pip");
      document.body.classList.remove("layout-pip");
    };
  }, [layoutMode]);

  if (!showApp) {
    return <BootSplash phase={splashPhase} onDone={revealApp} />;
  }

  const displayUser = user ?? MOCK_USER;
  const isAppPreview = !user;
  const token = getAccessToken() ?? "";
  const tabUser = user;
  const initials = displayUser.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (isCompactLayout(layoutMode)) {
    return <PipPresence user={displayUser} initials={initials} />;
  }

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: "home", label: "Overview", show: true },
    {
      id: "admin",
      label: "Admin",
      show: Boolean(tabUser?.staff),
    },
    {
      id: "host",
      label: "Host",
      show: Boolean(tabUser?.host),
    },
    {
      id: "trainer",
      label: "Trainer",
      show: Boolean(tabUser && tabUser.trainerTypes.length > 0),
    },
  ];

  const visibleTabs = tabs.filter((t) => t.show);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : "home";
  const copy = TAB_COPY[activeTab];

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
              className={`tab ${activeTab === t.id ? "active" : ""}`}
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
            message="Sample data — could not load your profile"
          />
        )}

        {error && (
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
          {activeTab === "home" && (
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
          {activeTab === "admin" && tabUser?.staff && (
            <AdminPanel token={token} preview={false} />
          )}
          {activeTab === "host" && tabUser?.host && (
            <HostPanel
              token={token}
              user={tabUser}
              preview={false}
              onTimezoneSaved={(timezone) => {
                if (user) {
                  setUser({ ...user, timezone, timezoneStored: true });
                }
              }}
            />
          )}
          {activeTab === "trainer" &&
            tabUser &&
            tabUser.trainerTypes.length > 0 && (
            <TrainerPanel user={tabUser} />
          )}
        </main>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { loadAdminOverview, type AdminOverview } from "../lib/admin";
import { formatPlusDay } from "../lib/plus";

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AdminScreen() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await loadAdminOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load admin.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="admin-screen">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <p className="meta" style={{ margin: 0 }}>
          Owner only. Visits and member plans. Document contents are not stored here.
        </p>
        <button type="button" className="secondary" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error && (
        <p className="meta" role="status" style={{ color: "#8b2e1f" }}>
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="fact-row admin-facts">
            <div className="fact">
              <strong>{data.visitsToday}</strong>
              <span>Visits today</span>
            </div>
            <div className="fact">
              <strong>{data.uniqueIpsToday}</strong>
              <span>IPs today</span>
            </div>
            <div className="fact">
              <strong>{data.members}</strong>
              <span>Signed-in accounts</span>
            </div>
            <div className="fact">
              <strong>
                {data.paid} paid · {data.free} free
              </strong>
              <span>Member types</span>
            </div>
            <div className="fact">
              <strong>{data.guests}</strong>
              <span>Non-members by IP</span>
            </div>
          </div>

          <section className="card admin-card">
            <h2>Members</h2>
            <p className="meta">Every signed-in email, with Plus or Free.</p>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Type</th>
                    <th>Last page</th>
                    <th>Last seen</th>
                    <th>Plus</th>
                  </tr>
                </thead>
                <tbody>
                  {data.membersList.length === 0 ? (
                    <tr>
                      <td colSpan={5}>No signed-in accounts yet.</td>
                    </tr>
                  ) : (
                    data.membersList.map((row) => (
                      <tr key={row.id}>
                        <td>{row.email || "—"}</td>
                        <td>{row.plan}</td>
                        <td>{row.lastPath || "—"}</td>
                        <td>{when(row.lastSeenAt || row.lastSignInAt)}</td>
                        <td>
                          {row.plan === "Paid"
                            ? row.cancelAtPeriodEnd && row.currentPeriodEnd
                              ? `cancels ${formatPlusDay(row.currentPeriodEnd)}`
                              : row.plusStatus
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card admin-card">
            <h2>Non-members by IP</h2>
            <p className="meta">People who used the site without signing in.</p>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>IP</th>
                    <th>Country</th>
                    <th>Visits</th>
                    <th>Last page</th>
                    <th>Came from</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.guestsList.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No guest visits stored yet.</td>
                    </tr>
                  ) : (
                    data.guestsList.map((row) => (
                      <tr key={row.ip}>
                        <td>{row.ip}</td>
                        <td>{row.country || "—"}</td>
                        <td>{row.visits}</td>
                        <td>{row.lastPath}</td>
                        <td>{row.lastReferrer || "direct"}</td>
                        <td>{when(row.lastSeenAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card admin-card">
            <h2>Where people go</h2>
            <div className="admin-split">
              <div>
                <h3>Pages</h3>
                <ul className="admin-list">
                  {data.topPaths.length === 0 ? <li>No pages yet.</li> : null}
                  {data.topPaths.map((row) => (
                    <li key={row.path}>
                      <span>{row.path}</span>
                      <strong>{row.count}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Came from</h3>
                <ul className="admin-list">
                  {data.topReferrers.length === 0 ? <li>Most visits are direct.</li> : null}
                  {data.topReferrers.map((row) => (
                    <li key={row.referrer}>
                      <span>{row.referrer}</span>
                      <strong>{row.count}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="card admin-card">
            <h2>Recent visits</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>IP</th>
                    <th>Page</th>
                    <th>Came from</th>
                    <th>Account</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentVisits.length === 0 ? (
                    <tr>
                      <td colSpan={5}>No visits stored yet. Open a page after this is live.</td>
                    </tr>
                  ) : (
                    data.recentVisits.map((row) => (
                      <tr key={row.id}>
                        <td>{when(row.at)}</td>
                        <td>
                          {row.ip}
                          {row.country ? ` · ${row.country}` : ""}
                        </td>
                        <td>{row.path}</td>
                        <td>{row.referrer || "direct"}</td>
                        <td>{row.email || "guest"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

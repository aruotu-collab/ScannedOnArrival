import { useEffect, useState } from "react";
import {
  loadAdminMessages,
  loadAdminOverview,
  replyToContactMessage,
  type AdminGuest,
  type AdminMember,
  type AdminOverview,
  type ContactMessage,
} from "../lib/admin";
import { formatPlusDay } from "../lib/plus";

type AdminTab = "visits" | "ips" | "members" | "plans" | "guests" | "messages";

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function utcDay(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

function MembersTable({ rows, empty }: { rows: AdminMember[]; empty: string }) {
  return (
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
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
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
  );
}

function IpsTable({ rows, empty }: { rows: AdminGuest[]; empty: string }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>IP</th>
            <th>Country</th>
            <th>Visits</th>
            <th>Last page</th>
            <th>Account</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.ip}>
                <td>{row.ip}</td>
                <td>{row.country || "—"}</td>
                <td>{row.visits}</td>
                <td>{row.lastPath}</td>
                <td>{row.email || "guest"}</td>
                <td>{when(row.lastSeenAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AdminScreen() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState<AdminTab>("visits");
  const [replyById, setReplyById] = useState<Record<string, string>>({});
  const [replyBusy, setReplyBusy] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);

  const refresh = async (quiet = false) => {
    if (!quiet) setBusy(true);
    setError(null);
    try {
      const [overview, inbox] = await Promise.all([loadAdminOverview(), loadAdminMessages()]);
      setData(overview);
      setMessages(inbox.messages);
      setOpenCount(inbox.open);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load admin.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(true), 15000);
    return () => window.clearInterval(id);
  }, []);

  const sendReply = async (id: string) => {
    const reply = (replyById[id] ?? "").trim();
    if (!reply) return;
    setReplyBusy(id);
    setReplyError(null);
    try {
      await replyToContactMessage(id, reply);
      setReplyById((current) => ({ ...current, [id]: "" }));
      await refresh(true);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Could not send that reply.");
    } finally {
      setReplyBusy(null);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const todayIps = (data?.guestsList ?? []).filter((row) => utcDay(row.lastSeenAt) === today);
  const guestIps = (data?.guestsList ?? []).filter((row) => !row.email);
  const paidMembers = (data?.membersList ?? []).filter((row) => row.plan === "Paid");
  const freeMembers = (data?.membersList ?? []).filter((row) => row.plan !== "Paid");
  const todayVisits = (data?.recentVisits ?? []).filter((row) => utcDay(row.at) === today);

  return (
    <div className="admin-screen">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <p className="meta" style={{ margin: 0 }}>
          Owner only. Tap a tile to open its details. Document contents are not stored here.
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
          <div className="fact-row admin-facts" role="tablist" aria-label="Admin sections">
            {(
              [
                ["visits", String(data.visitsToday), "Visits today"],
                ["ips", String(data.uniqueIpsToday), "IPs today"],
                ["members", String(data.members), "Signed-in accounts"],
                ["plans", `${data.paid} paid · ${data.free} free`, "Member types"],
                ["guests", String(data.guests), "Guest IPs"],
                ["messages", String(openCount), "Open messages"],
              ] as Array<[AdminTab, string, string]>
            ).map(([id, value, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={`fact admin-tab${tab === id ? " active" : ""}`}
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                <strong>{value}</strong>
                <span>{label}</span>
              </button>
            ))}
          </div>

          {tab === "visits" && (
            <>
              <section className="card admin-card">
                <h2>Visits today</h2>
                <p className="meta">Pages opened today, with the IP and whether they were signed in.</p>
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
                      {todayVisits.length === 0 ? (
                        <tr>
                          <td colSpan={5}>No visits stored for today yet.</td>
                        </tr>
                      ) : (
                        todayVisits.map((row) => (
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
            </>
          )}

          {tab === "ips" && (
            <section className="card admin-card">
              <h2>IPs today</h2>
              <p className="meta">Addresses that opened a page today, including signed-in people.</p>
              <IpsTable rows={todayIps} empty="No IPs stored for today yet." />
            </section>
          )}

          {tab === "members" && (
            <section className="card admin-card">
              <h2>Signed-in accounts</h2>
              <p className="meta">One row per email. The same address on a phone and a computer is one account.</p>
              <MembersTable rows={data.membersList} empty="No signed-in accounts yet." />
            </section>
          )}

          {tab === "plans" && (
            <section className="card admin-card">
              <h2>Member types</h2>
              <p className="meta">
                {data.paid} paid · {data.free} free. Paid is Plus; Free is signed in without Plus.
              </p>
              <h3>Paid</h3>
              <MembersTable rows={paidMembers} empty="No paid accounts yet." />
              <h3 style={{ marginTop: 18 }}>Free</h3>
              <MembersTable rows={freeMembers} empty="No free signed-in accounts yet." />
            </section>
          )}

          {tab === "guests" && (
            <section className="card admin-card">
              <h2>Guest IPs</h2>
              <p className="meta">People who opened a page without signing in.</p>
              <IpsTable rows={guestIps} empty="No guest IPs stored yet." />
            </section>
          )}

          {tab === "messages" && (
            <section className="card admin-card">
              <h2>Contact messages</h2>
              <p className="meta">People who used Contact us. Reply here and it emails them at the address they gave.</p>
              {replyError && (
                <p className="meta" role="status" style={{ color: "#8b2e1f" }}>
                  {replyError}
                </p>
              )}
              {messages.length === 0 ? (
                <p className="meta">No messages yet.</p>
              ) : (
                <div className="admin-messages">
                  {messages.map((row) => (
                    <article key={row.id} className="admin-message">
                      <header>
                        <strong>{row.name ? `${row.name} · ${row.email}` : row.email}</strong>
                        <span>
                          {row.status === "replied" ? "Replied" : "Open"} · {when(row.created_at)}
                          {row.ip ? ` · ${row.ip}` : ""}
                          {row.country ? ` · ${row.country}` : ""}
                        </span>
                      </header>
                      <p>{row.message}</p>
                      {row.reply_text && (
                        <p className="admin-reply-sent">
                          <strong>You replied {when(row.replied_at)}</strong>
                          {row.reply_text}
                        </p>
                      )}
                      {row.status !== "replied" && (
                        <div className="admin-reply">
                          <label className="field">
                            <span>Reply to {row.email}</span>
                            <textarea
                              rows={4}
                              value={replyById[row.id] ?? ""}
                              onChange={(e) => setReplyById((current) => ({ ...current, [row.id]: e.target.value }))}
                            />
                          </label>
                          <button
                            type="button"
                            className="primary"
                            disabled={replyBusy !== null || !(replyById[row.id] ?? "").trim()}
                            onClick={() => void sendReply(row.id)}
                          >
                            {replyBusy === row.id ? "Sending…" : "Send reply"}
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

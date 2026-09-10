import { useEffect, useState } from "react";
import {
  loadAdminMessages,
  loadAdminOverview,
  replyToContactMessage,
  type AdminOverview,
  type ContactMessage,
} from "../lib/admin";
import { formatPlusDay } from "../lib/plus";

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AdminScreen() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
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
              <span>Guest IPs</span>
            </div>
            <div className="fact">
              <strong>{openCount}</strong>
              <span>Open messages</span>
            </div>
          </div>

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

          <section className="card admin-card">
            <h2>Members</h2>
            <p className="meta">One row per email. The same address on a phone and a computer is one account.</p>
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
            <h2>Visitors by IP</h2>
            <p className="meta">Every address that opened a page, including yours. Signed-in visits show the email.</p>
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
                  {data.guestsList.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No visits stored yet. Open a page after this is live, then refresh.</td>
                    </tr>
                  ) : (
                    data.guestsList.map((row) => (
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

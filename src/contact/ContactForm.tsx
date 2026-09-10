import { useEffect, useState } from "react";
import { sendContactMessage } from "../lib/contact";

export function ContactForm({
  defaultEmail = "",
  onToast,
}: {
  defaultEmail?: string;
  onToast: (msg: string) => void;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultEmail && !email) setEmail(defaultEmail);
  }, [defaultEmail, email]);

  return (
    <form
      className="contact-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setError(null);
        setBusy(true);
        void (async () => {
          try {
            if (website.trim()) {
              onToast("Message sent. We will reply to this email.");
              setMessage("");
              return;
            }
            await sendContactMessage({ email, name, message });
            setMessage("");
            onToast("Message sent. We will reply to this email.");
          } catch (err) {
            const text = err instanceof Error ? err.message : "Could not send that message.";
            setError(text);
            onToast(text);
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <p className="meta">
        Ask a question or leave a comment. Include an email we can reply to. You do not need to be signed in.
      </p>
      <label className="honeypot" aria-hidden="true">
        <span>Website</span>
        <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      <label className="field" style={{ marginTop: 12 }}>
        <span>Your email</span>
        <input
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Name (optional)</span>
        <input
          type="text"
          autoComplete="name"
          placeholder="Alex"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Message</span>
        <textarea
          required
          rows={6}
          placeholder="How can we help?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      {error && (
        <p className="meta" role="status" style={{ color: "#8b2e1f" }}>
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={busy || !email.includes("@") || message.trim().length < 8}>
          {busy ? "Sending…" : "Send message"}
        </button>
      </div>
    </form>
  );
}

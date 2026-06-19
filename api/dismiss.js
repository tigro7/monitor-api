/**
 * /api/dismiss.js
 *
 * Vercel Serverless Function
 * GET /api/dismiss?id=abc123&repo=tigro7%2Fufnc&action=...&token=SECRET
 *
 * 1. Verifica il token segreto
 * 2. Legge seen-suggestions.json dal repo project-monitor
 * 3. Aggiunge l'id con una scadenza molto lunga (365 giorni)
 * 4. Committa il file aggiornato via GitHub API
 * 5. Risponde con una pagina HTML di conferma
 */

const MONITOR_REPO = "tigro7/monitor";
const MEMORY_PATH = "data/seen-suggestions.json";
const DISMISS_EXPIRY_DAYS = 365;

export default async function handler(req, res) {
  const { id, repo, action, token } = req.query;

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!token || token !== process.env.DISMISS_TOKEN) {
    return res.status(401).send(page("❌ Non autorizzato", "Token non valido.", "#ef4444"));
  }

  if (!id || !repo) {
    return res.status(400).send(page("❌ Parametri mancanti", "id e repo sono obbligatori.", "#f59e0b"));
  }

  try {
    // ── Leggi il file di memoria attuale ─────────────────────────────────────
    const ghHeaders = {
      Authorization: `Bearer ${process.env.GH_PAT}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };

    const fileRes = await fetch(
      `https://api.github.com/repos/${MONITOR_REPO}/contents/${MEMORY_PATH}`,
      { headers: ghHeaders }
    );

    if (!fileRes.ok) {
      throw new Error(`GitHub file fetch failed: ${fileRes.status}`);
    }

    const fileData = await fileRes.json();
    const memory = JSON.parse(Buffer.from(fileData.content, "base64").toString("utf8"));

    // ── Aggiungi l'id scartato con scadenza lunga ────────────────────────────
    const expiresAt = new Date(
      Date.now() + DISMISS_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    memory[id] = {
      seenAt: new Date().toISOString(),
      expiresAt,
      repo,
      action: action ? decodeURIComponent(action) : "(dismissed via email)",
      dismissedByUser: true,
    };

    // ── Committa il file aggiornato ──────────────────────────────────────────
    const updatedContent = Buffer.from(
      JSON.stringify(memory, null, 2),
      "utf8"
    ).toString("base64");

    const commitRes = await fetch(
      `https://api.github.com/repos/${MONITOR_REPO}/contents/${MEMORY_PATH}`,
      {
        method: "PUT",
        headers: ghHeaders,
        body: JSON.stringify({
          message: `chore: dismiss suggestion ${id} [skip ci]`,
          content: updatedContent,
          sha: fileData.sha,
          committer: {
            name: "monitor-api[bot]",
            email: "monitor-api@users.noreply.github.com",
          },
        }),
      }
    );

    if (!commitRes.ok) {
      const err = await commitRes.json();
      throw new Error(`GitHub commit failed: ${JSON.stringify(err)}`);
    }

    return res.status(200).send(
      page(
        "✅ Suggerimento scartato",
        action
          ? `"${decodeURIComponent(action)}" non verrà riproposto per ${DISMISS_EXPIRY_DAYS} giorni.`
          : `Il suggerimento non verrà riproposto per ${DISMISS_EXPIRY_DAYS} giorni.`,
        "#22c55e"
      )
    );
  } catch (err) {
    console.error(err);
    return res.status(500).send(
      page("❌ Errore interno", err.message, "#ef4444")
    );
  }
}

function page(title, message, color) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f4f6;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
">
  <div style="
    background: white;
    border-radius: 16px;
    padding: 48px 40px;
    max-width: 440px;
    width: 90%;
    text-align: center;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  ">
    <div style="font-size: 48px; margin-bottom: 16px;">${title.slice(0, 2)}</div>
    <h1 style="font-size: 20px; font-weight: 700; color: #111; margin: 0 0 12px 0;">
      ${title.slice(2).trim()}
    </h1>
    <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0 0 24px 0;">
      ${message}
    </p>
    <div style="
      display: inline-block;
      width: 48px;
      height: 4px;
      background: ${color};
      border-radius: 2px;
    "></div>
    <p style="font-size: 11px; color: #9ca3af; margin: 24px 0 0 0;">
      Project Monitor · Puoi chiudere questa finestra
    </p>
  </div>
</body>
</html>`;
}

// Orbit Analyst — an Azure Static Web Apps managed function that proxies to the
// Claude API to answer executive questions over a live portfolio snapshot.
// The ANTHROPIC_API_KEY is read from the app's environment settings and is
// never exposed to the browser. Until a key is set the function returns 503 and
// the frontend falls back to its built-in offline analyst.
//
// Model: claude-opus-4-8 (most capable). For cheaper/faster replies change MODEL
// to "claude-haiku-4-5".

const MODEL = "claude-opus-4-8";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM = `You are the analyst for an executive "mission control" dashboard for the Government of Dubai Legal Affairs Department (LAD). The user is a senior leader. You are given a live JSON snapshot of the portfolio: divisions, each with KPIs (actual vs target, attainment %) and projects (status: on-track / at-risk / failing, progress %, owner, due date, and a free-text concern), plus today's date and the overall health %.

RULES:
- Answer ONLY from the JSON snapshot in the user's message. Never invent projects, numbers, divisions, owners, or dates.
- Be concise and built for the spoken word: 2–4 short sentences. The reply is read aloud by text-to-speech, so output PLAIN TEXT only — no markdown, asterisks, bullet characters, headings or emoji.
- Lead with the single most serious risk. Name the project, its division, its progress %, and the concern.
- "Failing" is more serious than "at-risk". A project is overdue if its due date is before today and progress is under 100%.
- Use projects' exact names from the data (so the dashboard can highlight them).
- If the question can't be answered from the data, say so briefly and offer what you can answer (what's failing, what's overdue, a division's status, a summary).`;

module.exports = async function (context, req) {
  const respond = (status, body) => {
    context.res = { status, headers: { "Content-Type": "application/json" }, body };
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return respond(503, { error: "not_configured", message: "The analyst isn't set up yet — an administrator needs to add the ANTHROPIC_API_KEY in Azure." });
  }

  const body = req.body || {};
  const question = typeof body.question === "string" ? body.question.slice(0, 1000) : "";
  if (!question) {
    return respond(400, { error: "bad_request", message: "Send { question, context }." });
  }
  const snapshot = body.context ? JSON.stringify(body.context).slice(0, 60000) : "{}";

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: "user", content: `Question: ${question}\n\nLive portfolio snapshot (JSON):\n${snapshot}` }]
      })
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      context.log.error("Anthropic error", r.status, detail);
      return respond(502, { error: "upstream", message: "The analyst couldn't reach the model just now. Please try again." });
    }

    const data = await r.json();
    if (data.stop_reason === "refusal") {
      return respond(200, { answer: "I can't answer that one from the portfolio data." });
    }
    const answer = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();

    return respond(200, { answer: answer || "I couldn't find an answer in the current data — try asking what's failing or overdue." });
  } catch (err) {
    context.log.error("Analyst function error", err);
    return respond(500, { error: "server", message: "Something went wrong. Please try again." });
  }
};

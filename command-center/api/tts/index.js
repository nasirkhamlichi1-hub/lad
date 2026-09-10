// Orbit TTS — Azure Static Web Apps managed function for natural, conversational
// speech. Proxies text to Azure AI Speech (neural voices) and returns MP3 audio
// as base64 so the browser can play it. Keys live in Azure, never in the browser.
// Until SPEECH_KEY / SPEECH_REGION are set it returns 503 and the frontend falls
// back to the browser's best built-in voice.
//
// Voice: en-US-AvaMultilingualNeural — warm and conversational. Swap VOICE for
// another neural voice (e.g. en-US-AndrewMultilingualNeural, en-US-EmmaMultilingualNeural).

const VOICE = "en-US-AvaMultilingualNeural";

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

module.exports = async function (context, req) {
  const respond = (status, body) => {
    context.res = { status, headers: { "Content-Type": "application/json" }, body };
  };

  const key = process.env.SPEECH_KEY;
  const region = process.env.SPEECH_REGION;
  if (!key || !region) {
    return respond(503, { error: "not_configured", message: "Natural voice isn't set up — add SPEECH_KEY and SPEECH_REGION in Azure." });
  }

  const text = (req.body && typeof req.body.text === "string") ? req.body.text.slice(0, 1500) : "";
  if (!text) return respond(400, { error: "bad_request", message: "Send { text }." });

  const ssml =
    `<speak version='1.0' xml:lang='en-US'>` +
      `<voice name='${VOICE}'><prosody rate='+3%'>${escapeXml(text)}</prosody></voice>` +
    `</speak>`;

  try {
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "orbit-tts"
      },
      body: ssml
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      context.log.error("Azure TTS error", r.status, detail);
      return respond(502, { error: "upstream", message: "The voice service couldn't be reached." });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    return respond(200, { audio: buf.toString("base64") });
  } catch (err) {
    context.log.error("TTS function error", err);
    return respond(500, { error: "server", message: "Something went wrong generating speech." });
  }
};

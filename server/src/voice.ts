import express, { type Express } from "express";

/**
 * Voice I/O through OpenAI: speech-to-text for what the employee says, text-to-speech for
 * Clearance's replies. Claude still makes every decision; this is only the ears and mouth.
 */
const KEY = process.env.OPENAI_API_KEY;
const STT_MODEL = process.env.OPENAI_STT_MODEL ?? "gpt-transcribe";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE ?? "coral";

export const voiceEnabled = () => Boolean(KEY);

export function mountVoice(app: Express) {
  app.post("/api/voice/transcribe", express.raw({ type: () => true, limit: "15mb" }), async (req, res) => {
    if (!KEY) return res.status(503).json({ error: "Voice needs OPENAI_API_KEY." });
    const type = req.header("content-type")?.split(";")[0] || "audio/webm";
    const ext = type.includes("mp4") || type.includes("m4a") ? "mp4" : type.includes("mpeg") || type.includes("mp3") ? "mp3"
      : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("model", STT_MODEL);
    form.append("language", "en");
    form.append("prompt", "A UK employee asking their company's spend agent for funds. Amounts in pounds, e.g. £280.");
    form.append("file", new Blob([new Uint8Array(req.body as Buffer)], { type }), `speech.${ext}`);
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form });
    const body = (await r.json()) as { text?: string; error?: { message: string } };
    if (!r.ok) return res.status(502).json({ error: body.error?.message ?? "Transcription failed" });
    res.json({ text: body.text ?? "" });
  });

  app.post("/api/voice/speak", express.json(), async (req, res) => {
    if (!KEY) return res.status(503).json({ error: "Voice needs OPENAI_API_KEY." });
    const text = String(req.body?.text ?? "").slice(0, 1200);
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TTS_MODEL, voice: TTS_VOICE, input: text, response_format: "mp3",
        instructions: "You are Clearance, a sardonic, theatrically superior AI guarding the company's money — think CARROT Weather. Dry British wit, a hint of mock menace, perfectly timed pauses, smug when approving, delighted when refusing. Clear and brisk.",
      }),
    });
    if (!r.ok || !r.body) return res.status(502).json({ error: "Speech failed" });
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(await r.arrayBuffer()));
  });
}

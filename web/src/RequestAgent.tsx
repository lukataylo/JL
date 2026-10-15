import { useCallback, useEffect, useRef, useState } from "react";
import { api, money as fmtMoney, type Employee, type FundRequest, type NegotiationMessage } from "./api";
import { AgentOrb, type OrbState } from "./AgentOrb";
import { CATEGORY_META, type Category } from "./categories";
import "./request-agent.css";

/* Minimal Web Speech API typings (not in every TS DOM lib). */
interface SRAlt { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlt; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SR {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null; onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null; onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SR;
const SpeechRec: SRCtor | undefined =
  typeof window !== "undefined"
    ? ((window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).SpeechRecognition ??
       (window as unknown as { webkitSpeechRecognition?: SRCtor }).webkitSpeechRecognition)
    : undefined;
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);

/** £280 rather than £280.00 for whole pounds. */
const money = (p: number) => fmtMoney(p).replace(/\.00$/, "");

const OPENING = "What do you need, and why now?";
const SUGGESTIONS = [
  "£280 emergency plumber — office leak",
  "£150 taxi home after the late client call",
  "£900 replacement laptop, mine died before a demo",
];
const STEPS = ["Reading policy", "Checking your budget", "Deciding"];
const MUTE_KEY = "clearance:voice-muted";

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "en-GB" && /Daniel|Serena|Kate|Google UK English Female|Sonia|Libby/i.test(v.name)) ??
    voices.find((v) => v.lang === "en-GB") ??
    voices.find((v) => v.lang?.startsWith("en"))
  );
}

/** Full-screen "ask Clearance for funds" flow, voice or text. */
export function RequestAgent({ employee, category = null, onClose, onChange }: {
  employee: Employee;
  /** Picked in ExpensePicker before the chat opens. Null = open-ended request. */
  category?: Category | null;
  onClose: () => void;
  onChange: (req: FundRequest) => void;
}) {
  const meta = category ? CATEGORY_META[category] : null;
  const opening = meta?.opening || OPENING;
  const suggestions = meta?.suggestions.length ? meta.suggestions : SUGGESTIONS;
  const [req, setReq] = useState<FundRequest | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
  });
  const [offerHidden, setOfferHidden] = useState(false);
  const [closing, setClosing] = useState(false);

  const recRef = useRef<SR | null>(null);
  const finalRef = useRef("");
  const audioRef = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqRef = useRef<FundRequest | null>(null);
  const busyRef = useRef(false);
  const mutedRef = useRef(muted);
  const mounted = useRef(true);
  reqRef.current = req;
  busyRef.current = busy;
  mutedRef.current = muted;

  const status = req?.status;
  const final = status === "released" || status === "spent" || status === "denied" || status === "referred";

  /* ---------- TTS ---------- */
  const stopSpeaking = useCallback(() => {
    if (canSpeak) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((line: string) => {
    if (!canSpeak || mutedRef.current || !line) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(line);
    u.lang = "en-GB";
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.04;
    u.onstart = () => mounted.current && setSpeaking(true);
    u.onend = () => mounted.current && setSpeaking(false);
    u.onerror = () => mounted.current && setSpeaking(false);
    synth.speak(u);
  }, []);

  /** iOS only allows speech after a user gesture — prime it on the first tap. */
  const primed = useRef(false);
  const primeSpeech = () => {
    if (primed.current || !canSpeak) return;
    primed.current = true;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    mounted.current = true;
    if (canSpeak) window.speechSynthesis.getVoices(); // warm the voice list
    return () => {
      mounted.current = false;
      if (canSpeak) window.speechSynthesis.cancel();
      recRef.current?.abort();
      stopMeter();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- waiting steps ---------- */
  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1700);
    return () => window.clearInterval(id);
  }, [busy]);

  /* ---------- autoscroll ---------- */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [req?.messages.length, pending, interim, busy]);

  /* ---------- send ---------- */
  const send = useCallback(async (raw: string) => {
    const message = raw.trim();
    if (!message || busyRef.current) return;
    stopSpeaking();
    setError(null);
    setPending(message);
    setText("");
    setBusy(true);
    try {
      const cur = reqRef.current;
      const open = cur && (cur.status === "open" || cur.status === "countered");
      const next = await api.requestFunds(employee.id, message, open ? cur.id : null, open ? null : category);
      if (!mounted.current) return;
      setReq(next);
      setOfferHidden(false);
      onChange(next);
      const lastAgent = [...next.messages].reverse().find((m) => m.role === "agent");
      if (lastAgent) speak(lastAgent.text);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setText(message);
    } finally {
      if (mounted.current) {
        setPending(null);
        setBusy(false);
      }
    }
  }, [employee.id, category, onChange, speak, stopSpeaking]);

  const accept = async () => {
    if (!req || busy) return;
    primeSpeech();
    stopSpeaking();
    setError(null);
    setBusy(true);
    try {
      const next = await api.acceptFunds(req.id);
      if (!mounted.current) return;
      setReq(next);
      onChange(next);
      speak(`Done. ${money(next.amount_released ?? next.counter_amount ?? 0)} is on your card.`);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Couldn't accept the offer.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const startOver = () => {
    stopSpeaking();
    setReq(null);
    setError(null);
    setText("");
    setPending(null);
    setOfferHidden(false);
  };

  const close = () => {
    stopSpeaking();
    recRef.current?.abort();
    setClosing(true);
    window.setTimeout(onClose, 220);
  };

  /* ---------- mic level meter ---------- */
  function stopMeter() {
    const a = audioRef.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    a.stream.getTracks().forEach((t) => t.stop());
    a.ctx.close().catch(() => {});
    audioRef.current = null;
    setLevel(0);
  }

  async function startMeter() {
    // iOS Safari can't share the mic between getUserMedia and SpeechRecognition reliably.
    if (isIOS || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!recRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 5));
        if (audioRef.current) audioRef.current.raf = requestAnimationFrame(tick);
      };
      audioRef.current = { stream, ctx, raf: requestAnimationFrame(tick) };
    } catch { /* level is optional */ }
  }

  /* ---------- speech recognition ---------- */
  const startListening = () => {
    if (!SpeechRec || busy || final || listening) return;
    primeSpeech();
    stopSpeaking();
    setError(null);
    finalRef.current = "";
    setInterim("");
    let rec: SR;
    try {
      rec = new SpeechRec();
    } catch {
      setError("Voice isn't available here — type instead.");
      return;
    }
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let fin = "";
      let mid = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript; else mid += r[0].transcript;
      }
      finalRef.current = fin;
      setInterim((fin + " " + mid).trim());
      if (isIOS) setLevel(0.6);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Microphone blocked — allow it in your browser, or type instead.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("Didn't catch that — try again or type it.");
    };
    rec.onend = () => {
      recRef.current = null;
      stopMeter();
      if (!mounted.current) return;
      setListening(false);
      const said = (finalRef.current || "").trim();
      setInterim("");
      if (said) void send(said);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      void startMeter();
    } catch {
      recRef.current = null;
      setError("Couldn't start the microphone — type instead.");
    }
  };

  const stopListening = () => {
    // Keep what was heard so far: stop() fires onend, which sends the transcript.
    if (!finalRef.current && interim) finalRef.current = interim;
    recRef.current?.stop();
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* ignore */ }
    if (m) stopSpeaking();
  };

  /* ---------- derived UI ---------- */
  const orbState: OrbState =
    status === "released" || status === "spent" ? "approved"
    : status === "denied" ? "declined"
    : busy ? "thinking"
    : status === "countered" ? "countered"
    : status === "referred" ? "referred"
    : listening ? "listening"
    : speaking ? "speaking"
    : "idle";

  const requested = req?.amount_requested ?? null;
  const released = req?.amount_released ?? null;
  const counter = req?.counter_amount ?? null;

  let statusLine: string;
  let tone = "";
  if (busy) statusLine = "Clearance is checking policy…";
  else if (status === "released" || status === "spent") { statusLine = `Approved — ${money(released ?? 0)} is on your card`; tone = "ok"; }
  else if (status === "denied") { statusLine = "Declined"; tone = "bad"; }
  else if (status === "referred") { statusLine = "Sent to Priya Shah (Finance)"; tone = "warn"; }
  else if (listening) statusLine = "Listening…";
  else if (speaking) statusLine = "Clearance is speaking";
  else if (status === "countered" && counter != null) statusLine = requested ? `Offer: ${money(counter)} of ${money(requested)}` : `Offer: ${money(counter)}`;
  else if (status === "open") statusLine = "Your turn — answer Clearance";
  else statusLine = SpeechRec ? "Tap the mic and tell Clearance" : "Tell Clearance what you need";

  const msgs: NegotiationMessage[] = req?.messages ?? [];
  // Without voice, keep the suggestions around while the request is open so the demo can't stall.
  const showChips = (!req || (!SpeechRec && (req.status === "open"))) && !busy && !listening && !text;

  return (
    <div className={`ra-overlay${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Ask Clearance for funds">
      <div className={`ra-bloom ra-bloom--${orbState}`} aria-hidden />
      <div className="ra-shell">
        <header className="ra-header">
          <button className="ra-iconbtn" onClick={close} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <div className="ra-title">
            <div className="ra-title-name">Clearance</div>
            <div className="ra-title-sub"><i className={`ra-dot ra-dot--${orbState}`} />{released ? `${money(released)} on your card` : meta ? `${meta.label} · cards start at £0` : "Spend agent · cards start at £0"}</div>
          </div>
          {canSpeak ? (
            <button className={`ra-iconbtn${muted ? " is-off" : ""}`} onClick={toggleMute} aria-label={muted ? "Unmute spoken replies" : "Mute spoken replies"} aria-pressed={!muted}>
              {muted ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" /></svg>
              )}
            </button>
          ) : <span className="ra-iconbtn ra-iconbtn--ghost" aria-hidden />}
        </header>

        <section className="ra-stage">
          <button
            className="ra-orbbtn"
            onClick={listening ? stopListening : startListening}
            disabled={!SpeechRec || busy || final}
            aria-label={listening ? "Stop listening" : "Talk to Clearance"}
          >
            <AgentOrb state={orbState} size={196} level={level} />
          </button>
          <div className={`ra-status${tone ? ` ra-status--${tone}` : ""}`} aria-live="polite">{statusLine}</div>
          {busy && (
            <div className="ra-steps" aria-hidden>
              {STEPS.map((s, i) => (
                <span key={s} className={i < step ? "is-done" : i === step ? "is-on" : ""}>{s}</span>
              ))}
            </div>
          )}
        </section>

        <div className="ra-chat" ref={scrollRef}>
          <div className="ra-msg ra-msg--agent"><div className="ra-bubble">{opening}</div></div>
          {msgs.map((m, i) => (
            <div key={i} className={`ra-msg ra-msg--${m.role}`}>
              <div className="ra-bubble">{m.text}</div>
              {m.role === "agent" && m.cited_rules && m.cited_rules.length > 0 && (
                <div className="ra-rules">{m.cited_rules.map((r) => <span key={r}>{r}</span>)}</div>
              )}
            </div>
          ))}
          {pending && <div className="ra-msg ra-msg--employee"><div className="ra-bubble">{pending}</div></div>}
          {busy && <div className="ra-msg ra-msg--agent"><div className="ra-bubble ra-typing"><i /><i /><i /></div></div>}
          {listening && <div className="ra-msg ra-msg--employee"><div className="ra-bubble ra-bubble--live">{interim || "…"}</div></div>}
        </div>

        <div className="ra-dock">
          {error && (
            <div className="ra-error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          {(status === "released" || status === "spent") && req && (
            <div className="ra-outcome ra-outcome--ok">
              <div className="ra-outcome-kicker">Funds released</div>
              <div className="ra-outcome-amount">{money(released ?? 0)} <span>released</span></div>
              {req.purpose && <div className="ra-outcome-purpose">{req.purpose}</div>}
              <div className="ra-outcome-sub">Funds are on your card · ready to tap</div>
              <button className="ra-btn ra-btn--primary" onClick={close}>Back to card</button>
            </div>
          )}

          {status === "denied" && (
            <div className="ra-outcome ra-outcome--bad">
              <div className="ra-outcome-kicker">Declined</div>
              <div className="ra-outcome-title">No funds released</div>
              <div className="ra-outcome-sub">Clearance can't approve this under company policy. Nothing has been added to your card.</div>
              <div className="ra-outcome-actions">
                <button className="ra-btn ra-btn--primary" onClick={startOver}>Start over</button>
                <button className="ra-btn ra-btn--ghost" onClick={close}>Close</button>
              </div>
            </div>
          )}

          {status === "referred" && (
            <div className="ra-outcome ra-outcome--warn">
              <div className="ra-outcome-kicker">Referred</div>
              <div className="ra-outcome-title">Sent to Priya Shah (Finance)</div>
              <div className="ra-outcome-sub">With this conversation attached. You'll be notified when she decides.</div>
              <div className="ra-outcome-actions">
                <button className="ra-btn ra-btn--primary" onClick={close}>Done</button>
                <button className="ra-btn ra-btn--ghost" onClick={startOver}>New request</button>
              </div>
            </div>
          )}

          {status === "countered" && counter != null && !offerHidden && (
            <div className="ra-outcome ra-outcome--offer">
              <div className="ra-outcome-kicker">Counter-offer</div>
              <div className="ra-outcome-title">
                Clearance can release <b>{money(counter)}</b>{requested ? <> of {money(requested)}</> : null}
              </div>
              {requested ? <div className="ra-offer-bar"><span style={{ width: `${Math.min(100, (counter / requested) * 100)}%` }} /></div> : null}
              <div className="ra-outcome-actions">
                <button className="ra-btn ra-btn--primary" onClick={accept} disabled={busy}>Accept {money(counter)}</button>
                <button className="ra-btn ra-btn--ghost" disabled={busy} onClick={() => { setOfferHidden(true); setTimeout(() => inputRef.current?.focus(), 50); }}>Keep talking</button>
              </div>
            </div>
          )}

          {!final && !(status === "countered" && !offerHidden) && (
            <>
              {showChips && (
                <div className="ra-chips">
                  <span className="ra-chips-label">Try</span>
                  {suggestions.map((s) => (
                    <button key={s} className="ra-chip" onClick={() => { primeSpeech(); void send(s); }}>{s}</button>
                  ))}
                </div>
              )}
              <form
                className="ra-inputrow"
                onSubmit={(e) => { e.preventDefault(); primeSpeech(); void send(text); }}
              >
                <div className="ra-pill">
                  <input
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={req ? "Reply to Clearance…" : "e.g. £60 client lunch today"}
                    disabled={busy || listening}
                    enterKeyHint="send"
                    aria-label="Message Clearance"
                  />
                  <button type="submit" className="ra-send" disabled={busy || listening || !text.trim()} aria-label="Send">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </button>
                </div>
                {SpeechRec && (
                  <button
                    type="button"
                    className={`ra-mic${listening ? " is-on" : ""}`}
                    onClick={listening ? stopListening : startListening}
                    disabled={busy}
                    aria-label={listening ? "Stop listening" : "Speak to Clearance"}
                  >
                    {listening ? (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="3" /></svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
                    )}
                  </button>
                )}
              </form>
              {!SpeechRec && <div className="ra-hint">Voice isn't supported in this browser — type your request.</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

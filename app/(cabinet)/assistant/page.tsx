"use client";

import { Bot, Mic, SendHorizontal, Square, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { PageBody, PageHeader } from "@/components/cabinet/page-header";
import { LoadError } from "@/components/forms";
import { Card, Spinner } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { errorText, t } from "@/lib/i18n";
import { newOpId } from "@/lib/op";
import { cn } from "@/lib/utils";

type Msg = { id: string; role: "user" | "assistant"; text: string; links: { taskId: string; number: number; title: string }[]; at: number };
type Chat = { name: string; mode: "model" | "commands"; voice: boolean; help: string; messages: Msg[] };

export default function AssistantPage() {
  const { me } = useCabinet();
  const [chat, setChat] = React.useState<Chat | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const opId = React.useRef(newOpId());

  const load = React.useCallback(() => {
    setError(null);
    api<Chat>("GET", "/api/assistant")
      .then(setChat)
      .catch((e) => setError(errorText(e instanceof ApiError ? e.code : "network")));
  }, []);
  React.useEffect(load, [load]);
  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat?.messages.length, sending]);

  const append = (messages: Msg[]) => setChat((c) => (c ? { ...c, messages: [...c.messages, ...messages] } : c));

  const send = async (value: string) => {
    const body = value.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await api<{ messages: Msg[] }>("POST", "/api/assistant/message", { text: body, opId: opId.current });
      opId.current = newOpId();
      append(r.messages);
      setText("");
    } catch (e) {
      // Текст остаётся в поле; повтор с тем же opId не выполнит команду дважды.
      setSendError(errorText(e instanceof ApiError ? e.code : "network"));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageHeader title={t("nav.assistant")} />
      <PageBody className="flex justify-center">
        {error ? (
          <LoadError message={error} onRetry={load} />
        ) : !chat ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> {t("app.loading")}
          </p>
        ) : (
          <Card aria-label={chat.name} className="flex h-[calc(100dvh-var(--tabbar-h)-7.5rem)] w-full max-w-4xl flex-col overflow-hidden md:h-[calc(100dvh-7.5rem)]">
            <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md shadow-primary/20">
                <Bot className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[17px] font-bold">{chat.name}</p>
                <p className="flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", chat.mode === "model" ? "live-dot bg-success" : "bg-foreground/25")} />
                  {chat.mode === "model" ? t("assistant.modeModel") : t("assistant.modeCommands")}
                </p>
              </div>
            </header>

            <div ref={listRef} className="flex flex-1 flex-col gap-4 overflow-y-auto bg-background/60 px-4 py-5 sm:px-8" aria-live="polite">
              <Note>{me.role === "director" ? t("assistant.memoDirector") : t("assistant.memo")}</Note>
              {chat.mode === "commands" ? <Note>{t("assistant.noModel")}</Note> : null}
              {chat.messages.map((m) => (
                <Bubble key={m.id} msg={m} tz={me.company.timezone} />
              ))}
              {sending ? (
                <div className="flex items-center gap-1 self-start px-1 py-2" role="status" aria-label={t("assistant.thinking")}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} aria-hidden className="size-1.5 animate-bounce rounded-full bg-primary/50" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              ) : null}
            </div>

            <Composer
              text={text}
              setText={setText}
              sending={sending}
              voice={chat.voice}
              error={sendError}
              onSend={() => void send(text)}
              onVoice={async (blob) => {
                setSending(true);
                setSendError(null);
                try {
                  const form = new FormData();
                  form.set("audio", new File([blob], `voice.${blob.type.includes("mp4") ? "m4a" : "webm"}`, { type: blob.type }));
                  const res = await fetch("/api/assistant/voice", { method: "POST", body: form, credentials: "same-origin" });
                  const data = await res.json().catch(() => null);
                  if (!res.ok) throw new ApiError(data?.error?.code ?? "internal", res.status, null);
                  append((data as { messages: Msg[] }).messages);
                } catch (e) {
                  setSendError(errorText(e instanceof ApiError ? e.code : "network"));
                } finally {
                  setSending(false);
                }
              }}
            />
          </Card>
        )}
      </PageBody>
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-selected/60 px-4 py-3 text-sm leading-relaxed text-selected-foreground">{children}</p>;
}

function Bubble({ msg, tz }: { msg: Msg; tz: string }) {
  const mine = msg.role === "user";
  return (
    <div
      className={cn(
        "card-in max-w-[85%] text-[15px] leading-relaxed",
        mine ? "self-end rounded-[16px_16px_4px_16px] border border-primary/10 bg-selected/70 px-4 py-2.5" : "self-start rounded-[16px_16px_16px_4px] border border-border bg-surface px-4 py-2.5 shadow-[0_1px_2px_#1d24330a]",
      )}
    >
      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
      {msg.links.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {msg.links.map((l) => (
            <Link key={l.taskId} href={`/tasks/${l.taskId}`} className="rounded-lg border border-primary/20 bg-selected/60 px-2 py-1 text-[13px] font-semibold text-selected-foreground hover:underline">
              #{l.number} {l.title.length > 40 ? `${l.title.slice(0, 40)}…` : l.title}
            </Link>
          ))}
        </div>
      ) : null}
      <p className="mt-1 text-right text-xs text-foreground/50">{formatShortDateTime(msg.at, tz)}</p>
    </div>
  );
}

/** Поле сообщения и запись голоса: микрофон включается нажатием, запись можно отменить. */
function Composer({
  text,
  setText,
  sending,
  voice,
  error,
  onSend,
  onVoice,
}: {
  text: string;
  setText: (v: string) => void;
  sending: boolean;
  voice: boolean;
  error: string | null;
  onSend: () => void;
  onVoice: (blob: Blob) => Promise<void>;
}) {
  const [recording, setRecording] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);
  const [micError, setMicError] = React.useState<string | null>(null);
  const recorder = React.useRef<MediaRecorder | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  const cancelled = React.useRef(false);

  React.useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const start = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      cancelled.current = false;
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        if (!cancelled.current && chunks.current.length) void onVoice(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setRecording(true);
    } catch {
      setMicError(t("assistant.micDenied"));
    }
  };

  const stop = (cancel: boolean) => {
    cancelled.current = cancel;
    recorder.current?.stop();
  };

  return (
    <form
      className="flex flex-col gap-1 border-t border-border bg-surface px-3 py-3 sm:px-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      {error || micError ? <p className="px-2 text-sm text-danger">{error ?? micError}</p> : null}
      {recording ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => stop(true)} className="flex size-10 cursor-pointer items-center justify-center rounded-xl border border-border bg-surface text-foreground/70 hover:bg-muted" aria-label={t("assistant.cancelRecording")}>
            <X className="size-5" />
          </button>
          <p className="flex flex-1 items-center gap-2 text-[15px] font-semibold text-danger" aria-live="polite">
            <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-danger" />
            {t("assistant.recording")} {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </p>
          <button type="button" onClick={() => stop(false)} className="flex size-10 cursor-pointer items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm" aria-label={t("assistant.stopAndSend")}>
            <Square className="size-4 fill-current" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-[0_5px_20px_#8f9cc214] focus-within:border-primary/50">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter — отправить; Shift+Enter — новая строка; не во время составного ввода (IME).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder={t("assistant.placeholder")}
            aria-label={t("assistant.placeholder")}
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:outline-none"
          />
          {text.trim() ? (
            <button type="submit" disabled={sending} className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm disabled:opacity-60" aria-label={t("assistant.send")}>
              <SendHorizontal className="size-5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!voice || sending}
              onClick={() => void start()}
              title={voice ? t("assistant.record") : t("assistant.voiceOff")}
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary/10 text-primary disabled:opacity-50"
              aria-label={voice ? t("assistant.record") : t("assistant.voiceOff")}
            >
              <Mic className="size-5" />
            </button>
          )}
        </div>
      )}
    </form>
  );
}

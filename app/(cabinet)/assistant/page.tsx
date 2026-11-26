"use client";

import { Mic, SendHorizontal, Square, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { PageBody, PageHeader } from "@/components/cabinet/page-header";
import { LoadError } from "@/components/forms";
import { Spinner } from "@/components/ui/card";
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
          <section aria-label={chat.name} className="flex h-[calc(100dvh-9.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border shadow-sm md:h-[calc(100dvh-7rem)]">
            <header className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
              <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-[#25d366] text-base font-bold">
                {chat.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold">{chat.name}</p>
                <p className="truncate text-sm text-white/80">{chat.mode === "model" ? t("assistant.modeModel") : t("assistant.modeCommands")}</p>
              </div>
            </header>

            <div ref={listRef} className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[#efeae2] px-3 py-4 sm:px-5" aria-live="polite">
              <Note>{me.role === "director" ? t("assistant.memoDirector") : t("assistant.memo")}</Note>
              {chat.mode === "commands" ? <Note>{t("assistant.noModel")}</Note> : null}
              {chat.messages.map((m) => (
                <Bubble key={m.id} msg={m} tz={me.company.timezone} />
              ))}
              {sending ? (
                <div className="flex items-center gap-2 self-start rounded-lg bg-white px-3 py-2 text-sm text-muted-foreground shadow-sm">
                  <Spinner /> {t("assistant.thinking")}
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
          </section>
        )}
      </PageBody>
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto max-w-[92%] rounded-lg bg-[#fff5c4] px-4 py-2 text-center text-sm leading-relaxed text-[#54471b] shadow-sm">{children}</p>;
}

function Bubble({ msg, tz }: { msg: Msg; tz: string }) {
  const mine = msg.role === "user";
  return (
    <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-[15px] shadow-sm", mine ? "self-end bg-[#d9fdd3]" : "self-start bg-white")}>
      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
      {msg.links.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {msg.links.map((l) => (
            <Link key={l.taskId} href={`/tasks/${l.taskId}`} className="rounded-md border border-[#25d366]/40 bg-[#f0fdf4] px-2 py-1 text-sm font-semibold text-[#075e54] hover:underline">
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
      className="flex flex-col gap-1 border-t border-border bg-[#f0f2f5] px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      {error || micError ? <p className="px-2 text-sm text-destructive">{error ?? micError}</p> : null}
      {recording ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => stop(true)} className="flex size-11 items-center justify-center rounded-full bg-white text-foreground/70 shadow-sm" aria-label={t("assistant.cancelRecording")}>
            <X className="size-5" />
          </button>
          <p className="flex flex-1 items-center gap-2 text-[15px] font-semibold text-destructive" aria-live="polite">
            <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-destructive" />
            {t("assistant.recording")} {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </p>
          <button type="button" onClick={() => stop(false)} className="flex size-11 items-center justify-center rounded-full bg-[#25d366] text-white shadow-sm" aria-label={t("assistant.stopAndSend")}>
            <Square className="size-4 fill-current" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
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
            className="max-h-32 min-h-11 flex-1 resize-none rounded-3xl border border-border bg-white px-4 py-2.5 text-[15px] focus-visible:border-[#25d366]"
          />
          {text.trim() ? (
            <button type="submit" disabled={sending} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white shadow-sm disabled:opacity-60" aria-label={t("assistant.send")}>
              <SendHorizontal className="size-5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!voice || sending}
              onClick={() => void start()}
              title={voice ? t("assistant.record") : t("assistant.voiceOff")}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white shadow-sm disabled:opacity-50"
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

"use client";

import { api } from "./api";

/** Регистрация service worker (push и установка приложения). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

/** Событие «Установить приложение» (Chrome, Edge, Android) сохраняется для кнопки. */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferredInstall: InstallPrompt | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e as InstallPrompt;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    listeners.forEach((l) => l());
  });
}

export function canInstall(): boolean {
  return Boolean(deferredInstall);
}

export function isStandalone(): boolean {
  return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
}

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredInstall) return false;
  await deferredInstall.prompt();
  const choice = await deferredInstall.userChoice;
  deferredInstall = null;
  listeners.forEach((l) => l());
  return choice.outcome === "accepted";
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "===".slice((base64.length + 3) % 4)).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushState = "unsupported" | "denied" | "default" | "granted";

export function pushPermission(): PushState {
  if (typeof window === "undefined" || !("Notification" in window) || !("PushManager" in window)) return "unsupported";
  return Notification.permission as PushState;
}

/** Разрешение и подписка на push — отдельное действие участника. */
export async function enablePush(vapidPublicKey: string): Promise<PushState> {
  if (pushPermission() === "unsupported") return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission as PushState;
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource }));
  await api("POST", "/api/push/subscribe", sub.toJSON());
  return "granted";
}

export async function disablePush(): Promise<void> {
  if (pushPermission() === "unsupported") return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}

/** Выход: подписка устройства снимается, сессия отзывается на сервере. */
export async function logout(): Promise<void> {
  await disablePush().catch(() => {});
  await api("POST", "/api/auth/logout", {}, { redirectOn401: false }).catch(() => {});
  window.location.assign("/login?reason=logout");
}

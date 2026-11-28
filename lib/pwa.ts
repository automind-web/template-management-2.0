"use client";

import { api } from "./api";

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
/** One registration shared by the app and notification controls. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!registration) registration = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .catch(() => { registration = null; return null; });
  return registration;
}

async function readyWorker(): Promise<ServiceWorkerRegistration> {
  if (!(await registerServiceWorker())) throw new Error("service_worker_unavailable");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("service_worker_timeout")), 10_000);
    navigator.serviceWorker.ready.then((reg) => { clearTimeout(timeout); resolve(reg); }, (error) => { clearTimeout(timeout); reject(error); });
  });
}

export async function hasPushSubscription(): Promise<boolean> {
  if (pushPermission() !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return Boolean(sub && (!sub.expirationTime || sub.expirationTime > Date.now()));
}

/** Renew the existing device binding after login, without asking permission again. */
export async function syncPushSubscription(): Promise<void> {
  if (pushPermission() !== "granted") return;
  const reg = await readyWorker();
  const sub = await reg.pushManager.getSubscription();
  if (sub && (!sub.expirationTime || sub.expirationTime > Date.now())) await api("POST", "/api/push/subscribe", sub.toJSON());
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
  const event = deferredInstall;
  await event.prompt();
  const choice = await event.userChoice;
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
  const reg = await readyWorker();
  let existing = await reg.pushManager.getSubscription();
  const expected = urlBase64ToUint8Array(vapidPublicKey);
  const actual = existing?.options.applicationServerKey ? new Uint8Array(existing.options.applicationServerKey) : null;
  if (existing && ((existing.expirationTime && existing.expirationTime <= Date.now()) || !actual || actual.length !== expected.length || actual.some((byte, i) => byte !== expected[i]))) {
    await existing.unsubscribe();
    existing = null;
  }
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
  await api("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** Выход: подписка устройства снимается, сессия отзывается на сервере. */
export async function logout(): Promise<void> {
  await disablePush().catch(() => {});
  await api("POST", "/api/auth/logout", {}, { redirectOn401: false }).catch(() => {});
  window.location.assign("/login?reason=logout");
}

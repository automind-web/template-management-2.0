import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadActorByToken } from "@/server/context";
import { SESSION_COOKIE } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function Home() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const actor = await loadActorByToken(token).catch(() => null);
  redirect(actor ? "/tasks" : "/login");
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CabinetProvider, type Me } from "@/components/cabinet/cabinet-context";
import { CabinetShell } from "@/components/cabinet/shell";
import { loadActorByToken } from "@/server/context";
import { AppError } from "@/server/errors";
import { SESSION_COOKIE } from "@/server/http";
import { me } from "@/server/ops/org";

export const dynamic = "force-dynamic";

/** Кабинет доступен только с действующей сессией; роль и филиал читаются из БД на каждый запрос. */
export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  let initialMe: Me | null = null;
  let revoked = false;
  try {
    const actor = await loadActorByToken(token);
    if (actor) initialMe = (await me(actor)) as Me;
  } catch (error) {
    if (error instanceof AppError && error.code === "access_revoked") revoked = true;
    else throw error;
  }
  if (!initialMe) redirect(revoked ? "/login?reason=revoked" : "/login");

  return (
    <CabinetProvider initialMe={initialMe}>
      <CabinetShell>{children}</CabinetShell>
    </CabinetProvider>
  );
}

import { redirect } from "next/navigation";

/** Old task links and push notifications also open the side sheet. */
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/tasks?task=${encodeURIComponent(id)}`);
}

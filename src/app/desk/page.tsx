import { DeskClient } from "@/components/desk-client";
import { getDesk } from "@/lib/news/queries";

export const dynamic = "force-dynamic";

export default async function DeskPage() {
  const data = await getDesk();
  return <DeskClient data={data} />;
}

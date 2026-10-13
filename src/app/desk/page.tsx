import { DeskClient } from "@/components/desk-client";
import { getDesk } from "@/lib/news/queries";

export const revalidate = 60;

export default async function DeskPage() {
  const data = await getDesk();
  return <DeskClient data={data} />;
}

import { HomeClient } from "@/components/home-client";
import { getFeed } from "@/lib/news/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getFeed();
  return <HomeClient data={data} />;
}

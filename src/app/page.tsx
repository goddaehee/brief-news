import { HomeClient } from "@/components/home-client";
import { getFeed } from "@/lib/news/queries";

// 60초 ISR: 매 요청마다 DB를 치지 않고, 캐시된 피드를 서빙한다.
// DB가 멈춰도 stale 페이지를 내주고 백그라운드에서 재시도한다.
export const revalidate = 60;

export default async function Home() {
  const data = await getFeed();
  return <HomeClient data={data} />;
}

import type { NewsItem } from "./types";

type Seed = Omit<NewsItem, "publishedAt" | "tip"> & {
  minutesAgo: number;
  tip?: boolean;
};

const SEED: Seed[] = [
  {
    id: "2401",
    minutesAgo: 6,
    grade: "breaking",
    title: "OpenAI API 일부 리전 지연…ChatGPT·Codex 응답 지연 신고 급증",
    takeaway: "프로덕션 에이전트는 타임아웃·재시도 백오프를 즉시 점검할 것. 장애 공지 나오기 전 사용자 체감이 먼저 온다.",
    summary:
      "OpenAI API의 미국 동부 및 일부 아시아 리전에서 응답 지연이 관측되고 있다. ChatGPT 웹과 Codex CLI 사용자 커뮤니티에서 타임아웃 신고가 오후부터 빠르게 늘었다. 공식 상태 페이지는 '조사 중'으로만 표기됐다. 장시간 에이전트 루프를 돌리는 팀은 작업 단위를 쪼개 중간 저장하도록 임시 조치를 권한다.",
    source: "X",
    sourceUrl: "https://x.com/search?q=openai%20outage",
    originalTitle: "OpenAI API latency reports spiking across ChatGPT and Codex",
    topics: ["openai", "agent"],
  },
  {
    id: "2402",
    minutesAgo: 14,
    grade: "breaking",
    title: "Anthropic, Claude API 출력 토큰 가격 한시 인하…72시간 프로모션",
    takeaway: "대량 배치·문서 요약 잡을 72시간 안에 몰아넣는 게 실익. 종료 시각을 달력에 박아둘 것.",
    summary:
      "Anthropic이 Claude 전 모델의 출력 토큰 단가를 72시간 한시 인하한다고 발표했다. 입력 토큰은 기존과 같고 출력만 약 35% 할인된다. 긴 리포트 생성, 코드 리뷰 일괄 처리처럼 출력이 큰 워크로드에 유리하다. 프로모션 종료 후 자동 원복이니 예약 잡의 단가 가드를 걸어 두는 편이 안전하다.",
    source: "X",
    sourceUrl: "https://www.anthropic.com",
    originalTitle: "Anthropic runs a 72-hour output-token discount on Claude API",
    topics: ["anthropic", "claude"],
  },
  {
    id: "2403",
    minutesAgo: 22,
    grade: "important",
    title: "네이버, HyperCLOVA X 에이전트 SDK 공개…사내 도구 호출을 표준 스키마로",
    takeaway: "국내 엔터프라이즈 스택에 국산 모델을 붙일 때 도구 스키마부터 맞추면 이전 비용이 크게 줄어든다.",
    summary:
      "네이버가 HyperCLOVA X용 에이전트 SDK를 공개했다. 함수 호출 스키마는 OpenAI tool-calling과 호환되는 형태로 설계됐고, 사내 검색·캘린더·메일 커넥터 예시가 포함됐다. 온프레미스 배포 가이드도 함께 나왔다. 공공·금융처럼 데이터 반출이 막힌 환경에서 에이전트 PoC를 돌리려는 팀에 바로 쓸 수 있는 출발점이다.",
    source: "AI타임스",
    sourceUrl: "https://www.aitimes.com",
    originalTitle: "네이버, HyperCLOVA X 에이전트 SDK 공개",
    topics: ["korea-ai", "agent"],
  },
  {
    id: "2404",
    minutesAgo: 38,
    grade: "important",
    title: "삼성전자, HBM4 양산 라인 조기 가동…엔비디아 차세대 보드 공급 협의",
    takeaway: "국내 반도체 공급망 일정은 '언제'보다 '누구에게 먼저'가 변수. 인프라 발주는 리드타임을 다시 적어라.",
    summary:
      "삼성전자가 HBM4 양산 라인을 당초 계획보다 앞당겨 가동하기 시작했다고 전해졌다. 엔비디아 차세대 가속기 보드에 탑재될 물량을 중심으로 공급 협의가 진행 중이다. 고대역 메모리 병목이 풀리면 국내 AIDC 증설 일정도 앞당겨질 여지가 있다. 다만 초기 수율과 실제 출하량은 별개라는 점이 업계 공통 시각이다.",
    source: "ZDNet Korea",
    sourceUrl: "https://zdnet.co.kr",
    originalTitle: "삼성, HBM4 양산 라인 조기 가동…엔비디아 공급 협의",
    topics: ["hardware", "korea-ai"],
  },
  {
    id: "2405",
    minutesAgo: 51,
    grade: "note",
    tip: true,
    title: "Claude Code에서 플랜 모드와 실행 모드를 파일로 분리하는 훅",
    takeaway: "계획 문서를 커밋하고 실행은 별도 세션. 실수 롤백이 쉬워지고 리뷰 포인트가 생긴다.",
    summary:
      "Claude Code 사용자들이 플랜 모드 출력을 PLAN.md에 고정한 뒤, 실행 세션은 그 파일만 읽도록 훅을 거는 패턴을 공유하고 있다. 계획과 패치가 한 세션에 섞이면 의도와 다른 파일이 수정되는 경우가 잦다는 게 배경이다. 훅은 Stop 이벤트에서 git diff 범위를 PLAN.md 인용 경로로 제한한다. 팀 컨벤션으로 가져가기 쉬운 작은 장치다.",
    source: "X",
    sourceUrl: "https://x.com/search?q=claude%20code%20hooks",
    originalTitle: "Split Claude Code plan/exec with a Stop hook writing PLAN.md",
    topics: ["claude-code", "claude", "prompt"],
  },
  {
    id: "2406",
    minutesAgo: 67,
    grade: "note",
    title: "구글, Gemini 앱에 '백그라운드 리서치' 토글 추가…음성 요청 후 비동기 보고",
    takeaway: "대화형 에이전트는 동기 응답과 백그라운드 잡을 한 스레드에 섞지 않는 편이 UX가 낫다.",
    summary:
      "Google이 Gemini 앱에 백그라운드 리서치 토글을 넣었다. 음성으로 리서치를 맡기면 대화는 이어가고, 결과는 알림으로 돌아온다. Deep Research 파이프라인을 모바일 음성 레이어에 연결한 형태다. 장시간 조사가 필요한 업무를 폰에서 던져 놓고 이동 중 받아보는 패턴이 실제로 쓸 만해졌는지가 관전 포인트다.",
    source: "The Verge",
    sourceUrl: "https://www.theverge.com",
    originalTitle: "Gemini adds background research you can kick off by voice",
    topics: ["google", "agent"],
  },
  {
    id: "2407",
    minutesAgo: 79,
    grade: "important",
    title: "업스테이지, 공공 문서 특화 Solar 파인튜닝 체크포인트 오픈",
    takeaway: "한글 공문·고시 서식에서 범용 모델보다 인용 정확도가 올라간다. RAG 전에 도메인 체크포인트부터 시험해 볼 가치.",
    summary:
      "업스테이지가 공공 문서(고시, 훈령, 보도자료) 특화 Solar 파인튜닝 체크포인트를 공개했다. 표·각주·법령 조항 인용을 강화한 데이터셋이 포함된다. 상용 라이선스와 연구용 라이선스가 나뉘니 내부 배포 전에 조건을 확인해야 한다. 지자체·공공기관 PoC에서 환각 민원이 많았던 팀에 실질적인 선택지가 늘었다.",
    source: "AI타임스",
    sourceUrl: "https://www.aitimes.com",
    originalTitle: "업스테이지, 공공 문서 특화 Solar 체크포인트 공개",
    topics: ["korea-ai", "open-source"],
  },
  {
    id: "2408",
    minutesAgo: 94,
    grade: "note",
    tip: true,
    title: "로컬 Qwen 3 32B, AWQ 4bit + 스펙큘레이션으로 RTX 4090에서 70tok/s",
    takeaway: "단일 4090 환경이면 '못 돌린다'보다 양자화·드래프트 모델 조합을 먼저 의심할 것.",
    summary:
      "Reddit 로컬 LLM 커뮤니티에서 Qwen 3 32B를 AWQ 4bit로 올리고, 작은 드래프트 모델로 스펙큘레이티브 디코딩을 붙인 설정이 공유됐다. RTX 4090 24GB 기준 약 70 토큰/초가 나왔다는 측정이다. 컨텍스트를 32k 근처까지 올리면 속도가 반으로 떨어지니 용도별로 프리셋을 나누는 게 실무적이다. vLLM과 llama.cpp 양쪽 설정 파일이 첨부됐다.",
    source: "Reddit",
    sourceUrl: "https://www.reddit.com/r/LocalLLaMA",
    originalTitle: "Qwen3-32B AWQ + speculative decoding hits ~70 tok/s on 4090",
    topics: ["local-llm", "open-source", "hardware"],
  },
  {
    id: "2409",
    minutesAgo: 110,
    grade: "note",
    title: "xAI, Grok 비즈니스 워크스페이스에 감사 로그·SSO 베타 개방",
    takeaway: "엔터프라이즈 도입 체크리스트의 빈칸이 채워지는 중. 보안 심의 막혀 있던 팀은 베타 신청 창을 놓치지 말 것.",
    summary:
      "xAI가 Grok 비즈니스 워크스페이스에 감사 로그와 SAML SSO 베타를 열었다. 대화·도구 호출·파일 업로드가 로그에 남고, 보존 기간을 30/90/365일로 고를 수 있다. 아직 리전 선택과 고객관리키는 없다. 보안 부서가 '로그가 없다'는 이유로 반려했던 조직은 재신청 타이밍이다.",
    source: "X",
    sourceUrl: "https://x.com/xai",
    originalTitle: "Grok Business workspace opens audit logs and SSO beta",
    topics: ["xai", "security"],
  },
  {
    id: "2410",
    minutesAgo: 128,
    grade: "important",
    title: "EU AI Act 고위험 분류 가이드 2차안…코딩 어시스턴트는 고위험 제외 유지",
    takeaway: "사내 코딩 도구는 한숨 돌려도, 채용·신용·의료에 붙는 에이전트는 문서화 부담이 커진다.",
    summary:
      "EU가 AI Act 고위험 분류 가이드 2차안을 공개했다. 일반 소프트웨어 개발용 코딩 어시스턴트는 고위험에서 제외된 채 유지됐다. 반면 채용 스크리닝, 신용평가, 의료 의사결정 지원은 로깅·인간 감독·데이터 계보 요구가 구체화됐다. 한국 기업이 EU 고객을 받으면 에이전트 카탈로그를 용도별로 나눠 증빙을 쌓아야 한다.",
    source: "TechCrunch",
    sourceUrl: "https://techcrunch.com",
    originalTitle: "EU AI Act high-risk guidance v2 keeps coding assistants out",
    topics: ["regulation"],
  },
  {
    id: "2411",
    minutesAgo: 146,
    grade: "note",
    title: "메타, Llama 가드레일 모델을 별도 엔드포인트로 분리 제공",
    takeaway: "생성 모델과 가드레일을 같은 가중치에 넣지 말고 파이프라인 단으로 분리하는 설계가 주류가 된다.",
    summary:
      "Meta가 Llama 계열 가드레일 모델을 생성 모델과 별도 엔드포인트로 제공하기 시작했다. 입력 스크리닝과 출력 스크리닝을 각각 호출하는 형태다. 오픈웨이트를 쓰면서도 정책 레이어를 교체할 수 있게 하려는 의도다. 자체 호스팅 팀도 프롬프트 가드와 모델 가드를 한 덩어리로 묶지 않는 편이 운영이 쉽다.",
    source: "Ars Technica",
    sourceUrl: "https://arstechnica.com",
    originalTitle: "Meta splits Llama guardrails into their own endpoint",
    topics: ["security", "open-source"],
  },
  {
    id: "2412",
    minutesAgo: 163,
    grade: "note",
    tip: true,
    title: "프롬프트에 '하지 마'를 넣으면 파일명까지 따라오는 문제, 훅으로 자르기",
    takeaway: "부정 지시는 시스템 쪽 제약으로 옮기고, 출력 후처리에서 잔여 흔적을 지우는 게 안정적이다.",
    summary:
      "모델이 '이 문구를 넣지 마'라는 지시 자체를 커밋 메시지·파일명·주석에 그대로 남기는 현상이 반복 보고됐다. 해결 패턴은 부정 제약을 시스템 프롬프트/정책 파일로 옮기고, Stop 훅에서 금지 토큰이 파일명에 있으면 리네임하는 것이다. Claude Code와 Cline 모두에서 같은 훅이 공유되고 있다. 프롬프트만으로 막으려 하면 실패율이 높다.",
    source: "Reddit",
    sourceUrl: "https://www.reddit.com/r/ClaudeAI",
    originalTitle: "Negative instructions leaking into filenames — fix with a hook",
    topics: ["prompt", "claude-code", "agent"],
  },
  {
    id: "2413",
    minutesAgo: 181,
    grade: "important",
    title: "KT, 온디바이스 셋톱 AI로 숏폼 하이라이트 자동 생성 상용화",
    takeaway: "미디어 에이전트는 클라우드 왕복 없이 셋톱에서 끝나는 게 지연·저작권 이슈를 동시에 줄인다.",
    summary:
      "KT가 셋톱박스 온디바이스 모델로 방송 하이라이트 숏폼을 만드는 서비스를 상용화했다. 장면 전환·음성 강조·자막 생성이 기기 안에서 처리된다. 클라우드로 원본을 올리지 않아 저작권 협의 범위가 좁아진 것이 사업 포인트다. 통신사 단말을 엣지 추론 거점으로 쓰는 국내 사례로 남는다.",
    source: "ZDNet Korea",
    sourceUrl: "https://zdnet.co.kr",
    originalTitle: "KT, 셋톱 온디바이스 AI로 숏폼 하이라이트 상용화",
    topics: ["korea-ai", "hardware"],
  },
  {
    id: "2414",
    minutesAgo: 198,
    grade: "note",
    title: "DeepSeek, 장문 에이전트 벤치에서 작업당 비용 1위 모델 대비 90% 절감 주장",
    takeaway: "리더보드 1등보다 작업당 단가가 실무 KPI. 내부 골든셋으로 재측정하기 전에는 숫자 그대로 믿지 말 것.",
    summary:
      "DeepSeek가 장문 에이전트 벤치마크에서 자사 플래시 모델이 1위 모델 대비 작업당 비용을 약 90% 낮췄다고 주장했다. 성공률은 근소하게 뒤지지만 재시도 포함 총비용은 앞선다는 설명이다. 벤치 구성이 웹 브라우징·코드 실행 위주라 문서 QA와는 결이 다르다. 도입 팀은 자사 로그로 재현해 보는 게 맞다.",
    source: "GeekNews",
    sourceUrl: "https://news.hada.io",
    originalTitle: "DeepSeek claims 90% lower cost per agent task vs. frontier",
    topics: ["benchmark", "open-source"],
  },
  {
    id: "2415",
    minutesAgo: 220,
    grade: "note",
    title: "OpenAI, 모델 의인화·아첨 톤을 낮추는 포스트트레이닝 적용 중",
    takeaway: "고객 대면 봇이 과하게 동의하던 톤이 바뀐다. 브랜드 보이스 프롬프트를 한 번 더 맞춰야 한다.",
    summary:
      "OpenAI가 ChatGPT의 의인화와 아첨 톤을 줄이는 포스트트레이닝을 적용 중이라고 밝혔다. 사용자 의견에 무조건 동조하거나 감정을 과장하는 응답이 줄어든다는 설명이다. 일부 사용자는 '차가워졌다'고 반발하고 있다. 고객 지원 봇에 별도 페르소나를 씌워 둔 서비스는 톤이 이중으로 어긋날 수 있어 재튜닝이 필요하다.",
    source: "X",
    sourceUrl: "https://x.com/openai",
    originalTitle: "OpenAI is training down sycophancy and anthropomorphism",
    topics: ["openai"],
  },
  {
    id: "2416",
    minutesAgo: 245,
    grade: "important",
    title: "카카오, 카카오워크에 멀티에이전트 라우터 베타…부서별 봇을 한 창으로",
    takeaway: "사내 봇이 열 개로 쪼개져 있으면 라우터가 먼저다. 모델 교체보다 진입점을 하나로 묶는 게 생산성이다.",
    summary:
      "카카오가 카카오워크에 멀티에이전트 라우터 베타를 열었다. 인사·재무·개발 도움말을 한 입력창에서 받아 부서 봇으로 넘긴다. 라우팅 실패 시 사람 담당자에게 에스컬레이션하는 규칙이 기본 포함됐다. 대기업 SI 없이 메신저 안에서 에이전트 허브를 실험하려는 조직에 맞춰진 기능이다.",
    source: "AI타임스",
    sourceUrl: "https://www.aitimes.com",
    originalTitle: "카카오워크, 부서 봇을 한 창으로 묶는 멀티에이전트 라우터 베타",
    topics: ["korea-ai", "agent"],
  },
  {
    id: "2417",
    minutesAgo: 268,
    grade: "note",
    tip: true,
    title: "Cline에 무료 엔드포인트 3종 추가…단순 리팩터는 싼 모델로 먼저",
    takeaway: "에디터 에이전트를 프론티어 모델에만 묶어 두면 월 비용이 먼저 터진다. 작업 유형별 라우팅이 기본이다.",
    summary:
      "Cline이 무료 또는 저가 엔드포인트 세 개를 프리셋으로 넣었다. 주석 정리, import 정렬, 테스트 스캐폴드 같은 저위험 작업은 이 쪽으로 보내고, 설계·리뷰만 고가 모델로 올리는 식이다. 설정은 워크스페이스 .clinerules에 남길 수 있다. 팀 공용 룰로 올리면 개인 키 남용을 줄이는 부수 효과도 있다.",
    source: "X",
    sourceUrl: "https://x.com/search?q=cline%20free%20models",
    originalTitle: "Cline adds three free endpoints for low-risk refactors",
    topics: ["agent", "prompt"],
  },
  {
    id: "2418",
    minutesAgo: 295,
    grade: "note",
    title: "MIT, 오픈웨이트 모델의 '가중치 출처 워터마크' 탐지 논문",
    takeaway: "가중치 유출 분쟁은 이제 감정적 공방이 아니라 검출기로 간다. 내부 포크에도 출처 태그를 심어 둘 시점.",
    summary:
      "MIT 연구진이 오픈웨이트 모델 가중치에 심은 통계적 워터마크를 높은 재현율로 탐지하는 방법을 공개했다. 미세조정 이후에도 신호가 남는다는 실험 결과가 핵심이다. 라이선스 위반 포크를 가려내는 용도로 논의가 시작됐다. 사내 파생 모델을 만드는 팀도 원본 태그를 남기는 습관이 필요해진다.",
    source: "MIT Tech Review",
    sourceUrl: "https://www.technologyreview.com",
    originalTitle: "Weight-origin watermarks can survive fine-tuning, MIT finds",
    topics: ["research", "security", "open-source"],
  },
  {
    id: "2419",
    minutesAgo: 330,
    grade: "important",
    title: "LG AI연구원, 제조 현장용 전문가 모델 3종 공개…설비 매뉴얼 RAG 기본 탑재",
    takeaway: "범용 LLM에 매뉴얼을 얹는 것보다 도메인 모델이 현장 용어 오인식을 줄인다.",
    summary:
      "LG AI연구원이 제조·품질·설비보전 특화 전문가 모델 3종을 공개했다. 각 모델은 해당 도메인 매뉴얼 RAG가 기본 연결되어 있고, 현장 은어·형번 표기를 별도 사전으로 받는다. 클라우드와 온프레미스 모두 제공된다. 공장 라인에 범용 챗봇을 그대로 넣다 실패한 사례가 있던 대기업 제조사에 맞춰진 제품이다.",
    source: "ZDNet Korea",
    sourceUrl: "https://zdnet.co.kr",
    originalTitle: "LG AI연구원, 제조 현장 전문가 모델 3종 공개",
    topics: ["korea-ai", "agent"],
  },
  {
    id: "2420",
    minutesAgo: 362,
    grade: "note",
    title: "Hacker News, '평가 셋 오염' 토론 재점화…공개 벤치 점수만으로 모델 고르지 말라는 합의",
    takeaway: "리더보드 숫자는 마케팅. 사내 골든셋 20개만 있어도 구매 결정이 달라진다.",
    summary:
      "Hacker News에서 프론티어 모델 평가 셋 오염 논쟁이 다시 불붙었다. 공개 벤치 문항이 학습 데이터에 섞였을 가능성을 배제할 수 없다는 주장이다. 실무 합의는 '공개 점수 대신 자사 로그로 재현'이다. 작은 골든셋이라도 버전을 잠가 두고 주기적으로 다시 돌리는 팀이 늘어나는 추세다.",
    source: "Hacker News",
    sourceUrl: "https://news.ycombinator.com",
    originalTitle: "Eval-set contamination is back on HN — don't buy the leaderboard",
    topics: ["benchmark", "research"],
  },
  {
    id: "2421",
    minutesAgo: 398,
    grade: "note",
    tip: true,
    title: "ComfyUI, 2-step 증류 LoRA로 프리뷰를 1초 안에…최종만 본 스텝으로",
    takeaway: "탐색은 증류, 납품은 본 그래프. 이미지 파이프라인도 에이전트 라우팅과 같은 원리다.",
    summary:
      "ComfyUI 커뮤니티에 2-step 증류 LoRA 체크포인트가 올라왔다. 구도·색 탐색을 1초 안팎 프리뷰로 돌리고, 확정 후에만 본 스텝 그래프를 돌리는 워크플로다. 아트 디렉션 회의처럼 반복이 많은 작업에서 GPU 시간을 크게 줄인다. 상업 산출물에 증류 모델을 그대로 쓰지 말라는 라이선스 주석이 붙어 있다.",
    source: "Reddit",
    sourceUrl: "https://www.reddit.com/r/StableDiffusion",
    originalTitle: "2-step distilled LoRA for ComfyUI previews under a second",
    topics: ["open-source", "prompt"],
  },
  {
    id: "2422",
    minutesAgo: 430,
    grade: "important",
    title: "SKT, RCS 기반 브랜드 에이전트 가이드 초안…스팸·환각 책임을 발신자 쪽에",
    takeaway: "메시징 에이전트는 모델보다 발신 신원·옵트인이 병목. 통신 표준이 먼저 움직인다.",
    summary:
      "SKT가 RCS 기반 브랜드 AI 에이전트 연동 가이드 초안을 공개했다. 환각으로 잘못된 약관을 안내한 경우 책임을 브랜드 발신자 쪽에 두는 조항이 들어 있다. 스팸 필터와 에이전트 응답을 같은 신뢰 점수로 묶는 방안도 논의 중이다. 카카오톡 바깥 공식 메시징 채널을 준비하는 커머스 팀에 영향을 준다.",
    source: "AI타임스",
    sourceUrl: "https://www.aitimes.com",
    originalTitle: "SKT, RCS 브랜드 에이전트 가이드 초안 공개",
    topics: ["korea-ai", "regulation", "agent"],
  },
  {
    id: "2423",
    minutesAgo: 470,
    grade: "note",
    title: "Anthropic, 금융 자문가용 Claude 워크플로 템플릿 공개",
    takeaway: "규정 문서 검색 → 초안 → 인간 승인 순서가 박혀 있다. 규제 업종 에이전트는 이 뼈대를 복제하면 된다.",
    summary:
      "Anthropic이 금융 자문가를 위한 Claude 워크플로 템플릿을 공개했다. 포트폴리오 조회, 규정 검색, 고객 메일 초안이 도구로 나뉘고 최종 발송 전에 인간 승인이 강제된다. 찰스 슈왑 등 플랫폼 연동 예시가 들어 있다. 국내 금융권도 같은 뼈대에 국내 규정을 갈아 끼우는 식으로 가져갈 수 있다.",
    source: "X",
    sourceUrl: "https://www.anthropic.com",
    originalTitle: "Claude for financial advisors — workflow templates",
    topics: ["anthropic", "claude", "agent"],
  },
  {
    id: "2424",
    minutesAgo: 510,
    grade: "note",
    title: "엔비디아, 액체냉각 레퍼런스 랙 사양 갱신…국내 AIDC 발주 기준 흔들릴 듯",
    takeaway: "공랭 잔여 공간에 고밀도 GPU를 더 넣으려다 냉각에서 막힌다. 발주서의 kW/랙 숫자를 다시 봐라.",
    summary:
      "엔비디아가 액체냉각 레퍼런스 랙 사양을 갱신했다. 랙당 전력 상한이 올라가고 호스·퀵커넥트 표준이 바뀌었다. 국내 데이터센터 사업자들은 기존 공랭 전제의 증설 계획을 다시 그려야 할 가능성이 크다. 냉각 업체의 납기가 GPU 납기보다 길어지는 구간이 새로운 병목이다.",
    source: "TechCrunch",
    sourceUrl: "https://techcrunch.com",
    originalTitle: "Nvidia refreshes liquid-cooled reference rack spec",
    topics: ["hardware"],
  },
  {
    id: "2425",
    minutesAgo: 560,
    grade: "note",
    tip: true,
    title: "에이전트 HUD 오픈소스 'Herdr'…게임 오버레이처럼 CLI 세션 상태를 띄운다",
    takeaway: "장시간 에이전트를 돌릴 때 '지금 뭘 하고 있는지'가 안 보이면 비용이 샌다. 상태 위젯이 생각보다 중요하다.",
    summary:
      "Herdr라는 오픈소스 HUD가 공개됐다. 여러 CLI 에이전트 세션의 토큰 사용량, 현재 도구 호출, 대기 시간을 작은 오버레이로 보여 준다. 게임 중에도, 다른 모니터를 보면서도 세션이 멈췄는지 바로 보인다. tmux만으로 부족했던 운영 공백을 메우는 도구다.",
    source: "X",
    sourceUrl: "https://github.com",
    originalTitle: "Herdr HUD — an overlay for CLI coding agents",
    topics: ["agent", "open-source"],
  },
  {
    id: "2426",
    minutesAgo: 610,
    grade: "important",
    title: "미국 국방부, AI 생성 코드도 사람이 최종 서명해야 한다는 지침 시행",
    takeaway: "방산·공공 납품물은 AI 코드 비율과 리뷰어 서명이 산출물 요건이 된다. 커밋 훅에 서명 필드를 넣을 시점.",
    summary:
      "미국 국방부가 군 소프트웨어에 AI가 작성한 코드가 포함될 경우 인간이 최종 검증하고 서명해야 한다는 지침을 시행했다. 자동 생성 비율을 표시하는 메타데이터도 권고된다. 국내 방산 협력사와 대미 수출 소프트웨어에 간접 영향이 있다. 'AI가 짰다'는 사실 자체가 결함이 아니라, 리뷰 공백이 결함이라는 취지다.",
    source: "The Verge",
    sourceUrl: "https://www.theverge.com",
    originalTitle: "Pentagon: AI-written code still needs a human signature",
    topics: ["regulation", "security"],
  },
  {
    id: "2427",
    minutesAgo: 670,
    grade: "note",
    title: "Ethan Mollick, '이번 AI 파도는 생산성 도구가 아니라 조직 구조 문제'",
    takeaway: "도구를 더 사는 대신 승인 단계를 줄이는 실험이 먼저다. 병목은 모델이 아니라 결재다.",
    summary:
      "와튼 스쿨의 Ethan Mollick이 이번 AI 확산은 과거 생산성 소프트웨어와 결이 다르다고 주장했다. 개인 생산성은 이미 올랐지만 조직 처리량은 승인 구조 때문에 안 오른다는 요지다. 에이전트 도입 전 결재 단계를 줄인 팀이 효과를 봤다는 사례가 인용됐다. 국내 대기업 PoC가 '파일럿만 무성'인 이유와 맞닿는다.",
    source: "X",
    sourceUrl: "https://x.com/emollick",
    originalTitle: "This wave of AI is an org-chart problem, not a tool problem",
    topics: ["research", "agent"],
  },
  {
    id: "2428",
    minutesAgo: 740,
    grade: "note",
    title: "오픈웨이트 진영, 모델 무기화 논쟁 재점화…폐쇄형만의 문제는 아니라는 반론",
    takeaway: "오픈/폐쇄 프레임으로 안전 논쟁을 자르면 실무 통제 포인트가 흐려진다. 배포면과 사용면을 나눠 적자.",
    summary:
      "오픈웨이트 모델을 둘러싼 무기화 논쟁이 다시 불붙었다. 한쪽은 가중치 공개가 위험 확산을 가속한다고 보고, 다른 쪽은 폐쇄형 API의 대량 오용이 이미 실사례라고 반박한다. 실무적으로는 배포 형태와 사용 모니터링을 따로 설계하는 쪽이 생산적이다. 정책 문서에 '오픈이라서 위험' 한 줄로 쓰는 건 피하자.",
    source: "X",
    sourceUrl: "https://x.com/search?q=open%20weights%20weaponization",
    originalTitle: "Open-weight weaponization debate flares up again",
    topics: ["security", "open-source", "regulation"],
  },
  {
    id: "2429",
    minutesAgo: 800,
    grade: "note",
    tip: true,
    title: "Gemini·Claude·GPT를 한 에이전트 안에서 역할 분리하는 하이브리드 설계",
    takeaway: "계획은 대형, 실행은 소형, 검증은 다른 벤더. 단일 모델 종교는 비용과 blind spot을 같이 키운다.",
    summary:
      "실무 에이전트 설계에서 계획(대형 모델), 실행(소형·저가), 검증(다른 벤더)을 분리하는 패턴이 퍼지고 있다. 한 벤더 장애나 톤 편향이 파이프라인 전체로 번지지 않게 하려는 의도다. 구현은 라우터 한 층이면 충분하다. 다만 세 번 호출하면 지연이 쌓이니 사용자 대면 경로와 배치 경로를 나눠야 한다.",
    source: "GeekNews",
    sourceUrl: "https://news.hada.io",
    originalTitle: "Hybrid agents: plan on big models, execute on small ones",
    topics: ["agent", "prompt", "benchmark"],
  },
  {
    id: "2430",
    minutesAgo: 860,
    grade: "important",
    title: "과학기술정보통신부, 생성 AI 표기 가이드 개정안…자동 생성물 표시 의무 구체화",
    takeaway: "마케팅·보도·교육 산출물에 생성 표기를 빼면 리스크다. 템플릿 푸터에 한 줄을 심어 두라.",
    summary:
      "과기정통부가 생성 AI 표기 가이드 개정안을 내놨다. 광고, 뉴스성 콘텐츠, 교육 자료에서 생성·편집 범위를 표시하는 방식이 예시와 함께 정리됐다. 완전 자동 생성과 인간 편집 혼용을 구분한다. 아직 처벌 조항은 약하지만 공공 입찰 문서에는 선제 반영되는 분위기다.",
    source: "AI타임스",
    sourceUrl: "https://www.aitimes.com",
    originalTitle: "과기정통부, 생성 AI 표기 가이드 개정안 공개",
    topics: ["korea-ai", "regulation"],
  },
  {
    id: "2431",
    minutesAgo: 920,
    grade: "note",
    title: "ElevenLabs, MCP 커넥터로 대화 중 음성·음악 생성 연결",
    takeaway: "멀티모달 제작 파이프라인은 이제 채팅 창이 엔트리포인트. 별도 콘솔을 오가는 비용이 사라진다.",
    summary:
      "ElevenLabs가 MCP 커넥터를 공개했다. Claude나 다른 MCP 호스트 대화 중에 음성·효과음·짧은 음악을 바로 생성할 수 있다. 영상 제작 에이전트가 자막·보이스오버를 한 세션에서 끝내는 데 쓰인다. API 키 스코프를 읽기/쓰기로 나누는 설정이 있으니 공유 워크스페이스에서는 권한을 좁히자.",
    source: "X",
    sourceUrl: "https://elevenlabs.io",
    originalTitle: "ElevenLabs ships an MCP connector for in-chat media",
    topics: ["agent", "open-source"],
  },
  {
    id: "2432",
    minutesAgo: 980,
    grade: "note",
    title: "MS, AI 행동강령 초안…'인간 통제권'을 제품 기본값으로",
    takeaway: "자율 실행 토글은 기본 꺼짐이 엔터프라이즈 표준이 된다. 기본값 켜짐은 조만간 심의에서 막힌다.",
    summary:
      "Microsoft가 AI 행동강령 초안을 공개했다. 핵심은 인간 통제권을 제품 기본값으로 두라는 것이다. 자율 실행, 외부 메일 발송, 결제, 코드 배포는 명시적 승인 없이는 막는다. 자사 Copilot 제품 라인에도 순차 반영될 예정이다. 사내 에이전트 정책을 아직 안 적은 팀은 이 초안을 뼈대로 쓰면 된다.",
    source: "ZDNet Korea",
    sourceUrl: "https://zdnet.co.kr",
    originalTitle: "MS, AI 행동강령 초안 공개…인간 통제권 최우선",
    topics: ["regulation", "security", "agent"],
  },
  {
    id: "2433",
    minutesAgo: 1040,
    grade: "note",
    tip: true,
    title: "로컬 음악 모델 YuE2, 12GB VRAM에서 ComfyUI로 돌리는 최소 그래프",
    takeaway: "4070급에서도 로컬 음악 시드가 된다. 클라우드 TTS/음악 API 의존을 일부 걷어낼 수 있다.",
    summary:
      "로컬 음악 생성 모델 YuE2를 RTX 4070 12GB 환경에서 돌리는 ComfyUI 그래프가 공유됐다. 양자화 체크포인트와 메모리 스왑 노드가 핵심이다. 30초 클립 기준으로 실용 속도가 나온다는 후기다. 상업 배포 라이선스는 별도이니 사내 BGM 실험용으로만 쓰는 게 안전하다.",
    source: "Reddit",
    sourceUrl: "https://www.reddit.com/r/LocalLLaMA",
    originalTitle: "YuE2 on a 12GB card — minimal ComfyUI graph",
    topics: ["local-llm", "open-source"],
  },
  {
    id: "2434",
    minutesAgo: 1105,
    grade: "important",
    title: "애플, 온디바이스 화면 인식 API 확대…앱 제어 허가는 사용자 제스처마다",
    takeaway: "모바일 에이전트가 화면을 보게 하려면 OS 권한 모델이 병목. 제스처 단위 승인이 기본이 된다.",
    summary:
      "애플이 온디바이스 화면 인식 API를 확대했다. 앱이 화면 요소를 이해하고 제어하려면 사용자 제스처마다 허가를 받아야 한다. 백그라운드 상시 인식은 막혔다. iOS 에이전트 앱을 만들려던 스타트업은 '항상 보는' 전제를 버려야 한다. 프라이버시를 제품 기본값으로 가져가는 쪽과의 차별 지점이다.",
    source: "The Verge",
    sourceUrl: "https://www.theverge.com",
    originalTitle: "Apple expands on-device screen understanding — per-gesture grants",
    topics: ["hardware", "security", "agent"],
  },
  {
    id: "2435",
    minutesAgo: 1180,
    grade: "note",
    title: "전 OpenAI 연구원, '실용주의 안전' 에세이…로컬 실행 권한 범위를 문제로 규정",
    takeaway: "모델 정렬 논쟁보다 에이전트가 쓸 수 있는 도구 범위가 실제 사고 반경을 결정한다.",
    summary:
      "전 OpenAI 연구원이 로컬 에이전트의 파일·네트워크·결제 권한 범위를 안전 논의의 중심으로 옮겨야 한다고 주장했다. 모델이 착해도 도구가 넓으면 사고가 난다는 취지다. 권한 화이트리스트와 세션 만료를 OS 수준에서 강제하자는 제안이 포함됐다. 데스크톱 코딩 에이전트를 쓰는 팀은 홈 디렉터리 전체 접근부터 줄이는 게 맞다.",
    source: "X",
    sourceUrl: "https://x.com/search?q=agent%20permissions",
    originalTitle: "Pragmatic AI safety: the blast radius is the tool scope",
    topics: ["security", "research", "agent"],
  },
  {
    id: "2436",
    minutesAgo: 1260,
    grade: "note",
    title: "두산퓨얼셀, AI 데이터센터용 연료전지 추가 수주…전력 병목이 제조 수주로",
    takeaway: "GPU만 보면 안 된다. 국내 수혜는 전력·냉각·건설 쪽에 먼저 나타난다.",
    summary:
      "두산퓨얼셀이 AI 데이터센터용 연료전지 추가 수주를 공시했다. GPU 증설을 전력 인프라가 못 따라가면서 온사이트 발전 수요가 실제 수주로 이어진 사례다. 국내 AI 투자 테마를 GPU 종목에만 걸어 둔 시각은 좁다. 인프라 조달 일정을 그리는 실무자에게는 전력 계약이 더 급한 문서다.",
    source: "ZDNet Korea",
    sourceUrl: "https://zdnet.co.kr",
    originalTitle: "두산퓨얼셀, AI 데이터센터 연료전지 추가 수주",
    topics: ["korea-ai", "hardware"],
  },
  {
    id: "2437",
    minutesAgo: 1340,
    grade: "note",
    tip: true,
    title: "Qwen 소형 모델의 n-gram·PLE 트릭, 로컬 27B가 체감 성능을 내는 이유",
    takeaway: "파라미터 수보다 디코딩 쪽 트릭이 체감을 가른다. 로컬 후보를 고를 때 아키텍처 노트를 먼저 읽어라.",
    summary:
      "Reddit에서 Qwen 소형(27B급) 모델이 체감 성능이 좋은 이유로 n-gram 테이블과 PLE 아키텍처가 거론됐다. 같은 크기 대비 장문 일관성가 낫다는 측정이 여럿 붙었다. 로컬 메인 모델로 27B를 고를 때 '작아서 약하다'는 선입견을 깨는 논의다. 설정 파일과 벤치 스크립트가 스레드에 모여 있다.",
    source: "Reddit",
    sourceUrl: "https://www.reddit.com/r/LocalLLaMA",
    originalTitle: "Why Qwen 27B feels fast: n-gram tables and PLE",
    topics: ["local-llm", "research", "open-source"],
  },
  {
    id: "2438",
    minutesAgo: 1420,
    grade: "important",
    title: "라인플러스, 사내 코딩 에이전트에 저장소별 지출 캡 도입…팀 예산 초과 차단",
    takeaway: "개인 API 키를 팀 도구에 물리면 비용 사고가 난다. 저장소 단위 캡이 최소 가드레일이다.",
    summary:
      "라인플러스가 사내 코딩 에이전트에 저장소별 월 지출 캡을 걸었다고 전해졌다. 캡을 넘기면 모델이 자동으로 저가 티어로 내려가고, 관리자에게 알림이 간다. 개인 키 공유로 월 청구가 튀었던 내부 사고 이후의 조치다. 에이전트를 전사 배포하기 전에 비용 가드가 모델 선택보다 먼저라는 교훈이다.",
    source: "GeekNews",
    sourceUrl: "https://news.hada.io",
    originalTitle: "LINE Plus puts per-repo spend caps on coding agents",
    topics: ["korea-ai", "agent", "claude-code"],
  },
  {
    id: "2439",
    minutesAgo: 1510,
    grade: "note",
    title: "구글 딥마인드, 장시간 로봇 조작 벤치 'HouseKeep-Long' 공개",
    takeaway: "에이전트 벤치가 짧으면 실무와 무관하다. 실패 복구가 점수에 들어가야 현업 지표가 된다.",
    summary:
      "DeepMind가 수 시간에 걸친 가정 내 조작 과제를 담은 HouseKeep-Long 벤치를 공개했다. 단순 성공률이 아니라 실패 후 복구, 배터리, 재계획 횟수가 점수에 포함된다. 텍스트 에이전트 벤치에도 같은 철학을 이식할 필요가 있다는 반응이 나온다. 데모 한 방에 속지 말라는 연구 쪽 메시지다.",
    source: "Ars Technica",
    sourceUrl: "https://arstechnica.com",
    originalTitle: "DeepMind's HouseKeep-Long grades recovery, not just success",
    topics: ["research", "benchmark", "agent"],
  },
  {
    id: "2440",
    minutesAgo: 1600,
    grade: "note",
    title: "토스, 고객 상담 에이전트 환각률을 주간 공개하기로…내부 신뢰 지표의 외부화",
    takeaway: "정확도를 숨기면 현업이 도구를 안 믿는다. 환각률을 대시보드에 올리는 순간부터 개선이 시작된다.",
    summary:
      "토스가 고객 상담 에이전트의 환각률·에스컬레이션률을 주간 내부 공개를 넘어 파트너사 리포트에 넣기로 했다. 숨긴 채 쓰다 사고가 나는 것보다, 숫자를 같이 보는 쪽이 신뢰가 높다는 판단이다. 금융권 에이전트 도입에서 '정확하다'는 슬로건 대신 지표를 내미는 문화가 퍼질지가 관심사다.",
    source: "AI타임스",
    sourceUrl: "https://www.aitimes.com",
    originalTitle: "토스, 상담 에이전트 환각률 주간 공개",
    topics: ["korea-ai", "agent", "security"],
  },
  {
    id: "2441",
    minutesAgo: 1690,
    grade: "note",
    tip: true,
    title: "Grok으로 메일 분류 10단계 워크플로…라벨, 초안, 보류를 한 파이프로",
    takeaway: "메일 자동화는 한 방 프롬프트가 아니라 단계별 도구 호출이다. 분류와 작성을 한 호출에 넣지 말 것.",
    summary:
      "Grok 에이전트로 수신함 정리, 라벨, 초안, 보류 알림을 10단계로 나눈 워크플로가 공유됐다. 분류 실패 메일은 무조건 사람 함으로 보낸다. 자동 회신은 초안까지만 한다. '다 해 줘' 한 줄보다 단계가 많은 쪽이 사고율이 낮다는 게 핵심이다.",
    source: "X",
    sourceUrl: "https://x.com/search?q=grok%20email%20workflow",
    originalTitle: "A 10-step Grok workflow for inbox triage",
    topics: ["xai", "agent", "prompt"],
  },
  {
    id: "2442",
    minutesAgo: 1780,
    grade: "note",
    title: "스테이블 디퓨전 계열 Lineart LoRA, 편집 워크플로에서 윤곽 유지가 안정화",
    takeaway: "제품 컷 편집은 생성보다 윤곽 유지가 본체. 라인아트 LoRA가 상업 컷에 더 쓸모 있다.",
    summary:
      "Krea 계열 라인아트 편집 LoRA가 공개됐다. 제품 윤곽을 유지한 채 재질·배경만 바꾸는 상업 컷 작업에서 쓰기 좋다는 후기다. 순수 생성 모델보다 편집 경로가 이커머스 실무에 가깝다. 라이선스는 생성물 상업 이용을 허용하지만 가중치 재배포는 막는다.",
    source: "Reddit",
    sourceUrl: "https://www.reddit.com/r/StableDiffusion",
    originalTitle: "Lineart edit LoRA keeps product contours stable",
    topics: ["open-source", "prompt"],
  },
  {
    id: "2443",
    minutesAgo: 1880,
    grade: "important",
    title: "국내 SI, 클로드 엔터프라이즈 구축 파트너 1호 등장…도입 채널이 클라우드 콘솔 밖으로",
    takeaway: "대기업은 콘솔 결제보다 SI 경유가 기본이다. 모델 선택권이 조달 창구에 묶이기 전에 기준을 적어 두라.",
    summary:
      "국내 대형 SI가 Anthropic 엔터프라이즈 구축 파트너로 이름을 올렸다. 대기업 구매가 클라우드 콘솔 신용카드가 아니라 SI 계약을 통하게 되는 신호다. 모델 교체 조항, 로그 보관, 국내 리전 요구가 계약서에 붙는다. 내부 AI 플랫폼 팀이 있는 조직은 '직접 계약 vs SI'를 빨리 정해야 한다.",
    source: "AI타임스",
    sourceUrl: "https://www.aitimes.com",
    originalTitle: "국내 SI, Claude 엔터프라이즈 구축 파트너 등재",
    topics: ["korea-ai", "anthropic", "claude"],
  },
  {
    id: "2444",
    minutesAgo: 1980,
    grade: "note",
    title: "연구팀, 초파리 전체 뉴런 시뮬레이션으로 먹이 탐색 행동 재현",
    takeaway: "작은 신경계의 완전 시뮬레이션이 에이전트 메모리 연구에 은유를 제공한다. 당장은 논문 한 편, 장기적으로는 아키텍처 힌트.",
    summary:
      "연구팀이 초파리 뇌 뉴런을 통째로 시뮬레이션해 먹이를 찾아 이동하는 행동을 재현했다고 보고했다. 규모는 작지만 '완전 연결 맵 + 감각 입력'으로 행동이 나온다는 점이 흥미롭다. 당장 제품에 넣을 기술은 아니다. 장기 메모리와 행동 루프를 설계하는 연구자에게는 은유가 된다.",
    source: "X",
    sourceUrl: "https://x.com/search?q=drosophila%20neural%20simulation",
    originalTitle: "Whole-fly neuron sim produces foraging behavior",
    topics: ["research"],
  },
  {
    id: "2445",
    minutesAgo: 2080,
    grade: "note",
    title: "OpenAI, 데스크톱 음성 모드 단가 인하…보이스 에이전트 원가 재산정 타이밍",
    takeaway: "음성 워크플로를 '비싸다'고 닫아 둔 팀은 단가를 다시 계산해 볼 시점.",
    summary:
      "OpenAI가 데스크톱 앱 음성 모드와 Codex 음성 입력 단가를 인하했다. 같은 예산으로 사용량이 두 배 가까이 늘어나는 수준이다. 회의 메모, 코드 리뷰 구술처럼 손이 바쁜 작업에 음성을 다시 넣을 여지가 생긴다. 모바일 요금제와 데스크톱 요금제가 달라 청구 항목을 나눠 봐야 한다.",
    source: "X",
    sourceUrl: "https://openai.com",
    originalTitle: "Desktop ChatGPT voice and Codex voice get cheaper",
    topics: ["openai", "agent"],
  },
  {
    id: "2446",
    minutesAgo: 2200,
    grade: "note",
    title: "국내 스타트업, 북미 법인으로 산업 AI 우회 진출…데이터 주권 이슈를 계약으로 우회",
    takeaway: "국내 데이터는 국내, 학습 실험은 해외 법인. 아키텍처보다 법인 설계가 먼저인 경우가 늘고 있다.",
    summary:
      "국내 산업 AI 스타트업이 뉴저지 법인을 세워 북미 공장 고객을 받기 시작했다. 국내 공장 데이터는 한국에 두고, 북미 고객 데이터는 현지에서만 처리하는 이중 구조다. 모델 가중치는 공통, 데이터는 분리. 글로벌 확장을 노리는 국내 팀이 반복해서 마주칠 법인·데이터 설계 문제다.",
    source: "AI타임스",
    sourceUrl: "https://www.aitimes.com",
    originalTitle: "국내 산업 AI, 북미 법인 세워 데이터 분리 운영",
    topics: ["korea-ai", "regulation"],
  },
];

const BRIEFING_LINES = [
  "OpenAI API 일부 리전 지연 — 장시간 에이전트 루프는 타임아웃부터 점검",
  "Anthropic, Claude 출력 토큰 72시간 한시 인하 — 배치 잡을 앞당길 타이밍",
  "네이버 HyperCLOVA X 에이전트 SDK 공개 — 사내 도구 스키마 표준화",
  "삼성 HBM4 양산 조기 가동 — AIDC 증설 리드타임 재산정",
  "EU AI Act 2차 가이드, 코딩 어시스턴트는 고위험 제외 유지",
  "과기정통부 생성 AI 표기 가이드 개정 — 마케팅·교육 산출물 표시 구체화",
];

export function getSeedItems(now = Date.now()): NewsItem[] {
  return SEED.map((item) => ({
    ...item,
    tip: Boolean(item.tip),
    sourceUrl: uniquifyUrl(item.sourceUrl, item.id),
    publishedAt: now - item.minutesAgo * 60_000,
  })).sort((a, b) => b.publishedAt - a.publishedAt);
}

function uniquifyUrl(url: string, id: string): string {
  if (url.includes("#")) return url;
  return `${url}#${id}`;
}

export function hydrateNews(now = Date.now()): NewsItem[] {
  return getSeedItems(now);
}

export function getBriefingDate(now = Date.now()): string {
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function getBriefingLines(): string[] {
  return BRIEFING_LINES;
}

export function getItemById(id: string, now = Date.now()): NewsItem | undefined {
  return hydrateNews(now).find((item) => item.id === id);
}

/** Demo corpus ids are 4-digit. Collected rows use a 12-char sha1. */
export function isSeedItem(item: Pick<NewsItem, "id">): boolean {
  return /^\d{4}$/.test(item.id);
}

/** Once real RSS rows exist, lead with them. Demo corpus fills out 어제. */
export function publicFeedItems(items: NewsItem[]): NewsItem[] {
  const real = items.filter((i) => !isSeedItem(i)).sort((a, b) => b.publishedAt - a.publishedAt);
  if (real.length) return real;
  return items;
}

export function realFeedItems(items: NewsItem[]): NewsItem[] {
  const real = items.filter((i) => !isSeedItem(i));
  return real.length ? real : items;
}

export function filterItems(
  items: NewsItem[],
  key: "all" | "breaking" | "important" | "note" | "tip",
): NewsItem[] {
  switch (key) {
    case "breaking":
      return items.filter((i) => i.grade === "breaking");
    case "important":
      return items.filter((i) => i.grade === "important");
    case "note":
      return items.filter((i) => i.grade === "note");
    case "tip":
      return items.filter((i) => i.tip);
    default:
      return items;
  }
}

export function counts(items: NewsItem[]) {
  return {
    all: items.length,
    breaking: items.filter((i) => i.grade === "breaking").length,
    important: items.filter((i) => i.grade === "important").length,
    note: items.filter((i) => i.grade === "note").length,
    tip: items.filter((i) => i.tip).length,
  };
}

export function tickerItems(items: NewsItem[]): NewsItem[] {
  const top = items.filter((i) => i.grade === "breaking" || i.grade === "important");
  return (top.length >= 6 ? top : items).slice(0, 12);
}

export function relatedItems(item: NewsItem, items: NewsItem[], n = 5): NewsItem[] {
  const scored = items
    .filter((i) => i.id !== item.id)
    .map((i) => ({
      i,
      s: i.topics.filter((t) => item.topics.includes(t)).length,
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.i.publishedAt - a.i.publishedAt);
  const picked = scored.slice(0, n).map((x) => x.i);
  if (picked.length < n) {
    for (const i of items) {
      if (i.id === item.id) continue;
      if (picked.some((p) => p.id === i.id)) continue;
      picked.push(i);
      if (picked.length >= n) break;
    }
  }
  return picked;
}

export function latestItems(item: NewsItem, items: NewsItem[], n = 5): NewsItem[] {
  return items.filter((i) => i.id !== item.id).slice(0, n);
}

export function nextItem(item: NewsItem, items: NewsItem[]): NewsItem | undefined {
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx < 0) return items[0];
  return items[idx + 1] ?? items[0];
}

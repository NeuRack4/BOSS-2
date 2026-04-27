"use client";

const SECTION_CONFIG = [
  {
    key: "현재 가격 분석",
    label: "현재 가격 분석",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-500",
    num: 1,
    numColor: "bg-blue-500",
  },
  {
    key: "시장 포지셔닝",
    label: "시장 포지셔닝",
    color: "bg-violet-50 text-violet-700 border-violet-200",
    dot: "bg-violet-500",
    num: 2,
    numColor: "bg-violet-500",
  },
  {
    key: "추천 가격대 및 근거",
    label: "추천 가격대 및 근거",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
    num: 3,
    numColor: "bg-emerald-500",
  },
  {
    key: "실행 방안",
    label: "실행 방안",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
    num: 4,
    numColor: "bg-amber-500",
  },
] as const;

function parseSection(content: string, heading: string): string {
  const regex = new RegExp(
    `##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "i"
  );
  const match = content.match(regex);
  return match ? match[1].trim() : "";
}

function renderLines(text: string) {
  return text.split("\n").map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // 번호 리스트 (1. 2. 3.)
    const numMatch = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*:?\s*(.*)/);
    if (numMatch) {
      const [, num, bold, rest] = numMatch;
      const cfg = SECTION_CONFIG[parseInt(num) - 1];
      const numColor = cfg?.numColor ?? "bg-gray-400";
      return (
        <div key={i} className="flex items-start gap-2.5 py-1">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${numColor}`}
          >
            {num}
          </span>
          <span className="text-[13px] leading-relaxed text-[#030303]">
            <span className="font-semibold">{bold}</span>
            {rest ? `: ${rest}` : ""}
          </span>
        </div>
      );
    }

    // 불릿 리스트
    const bulletMatch = trimmed.match(/^[-•]\s+\*\*(.+?)\*\*:?\s*(.*)/);
    if (bulletMatch) {
      const [, bold, rest] = bulletMatch;
      return (
        <div key={i} className="flex items-start gap-2 py-0.5">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#030303]/30" />
          <span className="text-[13px] leading-relaxed text-[#030303]">
            <span className="font-semibold">{bold}</span>
            {rest ? `: ${rest}` : ""}
          </span>
        </div>
      );
    }

    // 일반 불릿
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      return (
        <div key={i} className="flex items-start gap-2 py-0.5">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#030303]/30" />
          <span className="text-[13px] leading-relaxed text-[#030303]">
            {trimmed.slice(2)}
          </span>
        </div>
      );
    }

    // 볼드 인라인 처리
    const parts = trimmed.split(/\*\*(.+?)\*\*/g);
    return (
      <p key={i} className="py-0.5 text-[13px] leading-relaxed text-[#030303]">
        {parts.map((p, j) =>
          j % 2 === 1 ? (
            <strong key={j} className="font-semibold">
              {p}
            </strong>
          ) : (
            p
          )
        )}
      </p>
    );
  });
}

type Props = {
  content: string;
};

export function PriceStrategyView({ content }: Props) {
  const sections = SECTION_CONFIG.map((cfg) => ({
    ...cfg,
    body: parseSection(content, cfg.key),
  })).filter((s) => s.body);

  // 섹션 파싱 안 되면 원문 그대로
  if (sections.length === 0) {
    return (
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#030303]">
        {content}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {sections.map((sec) => (
        <div key={sec.key} className="flex flex-col gap-3">
          {/* 섹션 헤더 라벨 */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide ${sec.color}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${sec.dot}`}
              />
              {sec.label}
            </span>
          </div>

          {/* 섹션 내용 */}
          <div className="rounded-[6px] border border-[#030303]/[0.07] bg-white px-4 py-3">
            {renderLines(sec.body)}
          </div>
        </div>
      ))}
    </div>
  );
}

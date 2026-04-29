"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type ResumeApplicant = {
  phone?: string | null;
  email?: string | null;
  age?: number | null;
  address?: string | null;
  skills?: string[] | null;
  education?: Array<{
    school?: string;
    major?: string;
    degree?: string;
    year?: string;
  }> | null;
  experience?: Array<{
    company?: string;
    role?: string;
    period?: string;
    description?: string;
  }> | null;
  projects?: Array<{
    name?: string;
    role?: string;
    period?: string;
    tech_stack?: string;
    description?: string;
  }> | null;
  training?: Array<{
    institution?: string;
    course?: string;
    period?: string;
    description?: string;
  }> | null;
  certifications?: string[] | null;
  desired_position?: string | null;
  desired_salary?: string | null;
  introduction?: string | null;
};

export type ResumePayload = {
  resume_id: string;
  artifact_id?: string;
  name: string;
  applicant: ResumeApplicant;
};

const RESUME_PARSED_RE =
  /\[\[RESUME_PARSED\]\]([\s\S]*?)\[\[\/RESUME_PARSED\]\]/g;

export const extractResumePayloads = (
  text: string,
): { cleaned: string; payloads: ResumePayload[] } => {
  const payloads: ResumePayload[] = [];
  let cleaned = text;
  const re = new RegExp(RESUME_PARSED_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      payloads.push(JSON.parse(m[1]) as ResumePayload);
    } catch {
      /* ignore */
    }
    cleaned = cleaned.replace(m[0], "");
  }
  return { cleaned: cleaned.trim(), payloads };
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="mt-3">
    <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
      {title}
    </div>
    {children}
  </div>
);

const InfoRow = ({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) => {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-[13px] py-1 border-b border-neutral-100 last:border-0">
      <span className="w-20 shrink-0 text-neutral-500">{label}</span>
      <span className="text-neutral-800 break-all">{value}</span>
    </div>
  );
};

export const ResumeCard = ({ payload }: { payload: ResumePayload }) => {
  const [expanded, setExpanded] = useState(false);
  const a = payload.applicant;
  const skills = a.skills ?? [];
  const education = a.education ?? [];
  const experience = a.experience ?? [];
  const projects = a.projects ?? [];
  const training = a.training ?? [];
  const certs = a.certifications ?? [];

  const hasMore =
    experience.length > 0 ||
    projects.length > 0 ||
    training.length > 0 ||
    certs.length > 0 ||
    a.introduction;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#f5f3ef] border-b border-neutral-200">
        <div className="w-8 h-8 rounded-full bg-[#4a7c59]/15 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-[#4a7c59]" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-neutral-900">
            {payload.name}
          </div>
          {a.desired_position && (
            <div className="text-[12px] text-neutral-500">
              {a.desired_position}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        {/* 기본 정보 */}
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-1">
          <InfoRow label="연락처" value={a.phone} />
          <InfoRow label="이메일" value={a.email} />
          <InfoRow label="나이" value={a.age != null ? `${a.age}세` : null} />
          <InfoRow label="주소" value={a.address} />
          {a.desired_salary && (
            <InfoRow label="희망급여" value={a.desired_salary} />
          )}
        </div>

        {/* 기술 스택 */}
        {skills.length > 0 && (
          <Section title="기술 스택">
            <div className="flex flex-wrap gap-1.5">
              {skills.map((sk, i) => (
                <span
                  key={i}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-[#4a7c59]/10 text-[#2d5c3a] font-medium"
                >
                  {sk}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* 학력 */}
        {education.length > 0 && (
          <Section title="학력">
            <div className="space-y-1.5">
              {education.map((e, i) => (
                <div key={i} className="text-[13px]">
                  <span className="font-medium text-neutral-800">
                    {e.school}
                  </span>
                  {e.major && (
                    <span className="text-neutral-600"> · {e.major}</span>
                  )}
                  {e.degree && (
                    <span className="text-neutral-500"> ({e.degree})</span>
                  )}
                  {e.year && (
                    <span className="text-neutral-400 text-[12px] ml-1">
                      {e.year}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 확장 영역 */}
        {hasMore && (
          <>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 flex items-center gap-1 text-[12px] text-neutral-500 hover:text-neutral-700 transition-colors"
            >
              {expanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              {expanded ? "접기" : "경력 · 프로젝트 · 자기소개 더 보기"}
            </button>

            {expanded && (
              <div className="mt-2 space-y-3">
                {experience.length > 0 && (
                  <Section title="경력">
                    <div className="space-y-2">
                      {experience.map((ex, i) => (
                        <div
                          key={i}
                          className="text-[13px] rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium text-neutral-800">
                              {ex.company}
                            </span>
                            {ex.period && (
                              <span className="text-[11px] text-neutral-400 shrink-0">
                                {ex.period}
                              </span>
                            )}
                          </div>
                          {ex.role && (
                            <div className="text-[12px] text-neutral-600 mt-0.5">
                              {ex.role}
                            </div>
                          )}
                          {ex.description && (
                            <div className="text-[12px] text-neutral-500 mt-1 whitespace-pre-line line-clamp-3">
                              {ex.description}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {projects.length > 0 && (
                  <Section title="프로젝트">
                    <div className="space-y-2">
                      {projects.map((p, i) => (
                        <div
                          key={i}
                          className="text-[13px] rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium text-neutral-800">
                              {p.name}
                            </span>
                            {p.period && (
                              <span className="text-[11px] text-neutral-400 shrink-0">
                                {p.period}
                              </span>
                            )}
                          </div>
                          {p.role && (
                            <div className="text-[12px] text-neutral-600 mt-0.5">
                              {p.role}
                            </div>
                          )}
                          {p.tech_stack && (
                            <div className="text-[11px] text-[#4a7c59] mt-0.5">
                              {p.tech_stack}
                            </div>
                          )}
                          {p.description && (
                            <div className="text-[12px] text-neutral-500 mt-1 whitespace-pre-line line-clamp-3">
                              {p.description}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {training.length > 0 && (
                  <Section title="교육 · 연수">
                    <div className="space-y-1.5">
                      {training.map((t, i) => (
                        <div key={i} className="text-[13px]">
                          <span className="font-medium text-neutral-800">
                            {t.institution}
                          </span>
                          {t.course && (
                            <span className="text-neutral-600">
                              {" "}
                              · {t.course}
                            </span>
                          )}
                          {t.period && (
                            <span className="text-neutral-400 text-[12px] ml-1">
                              {t.period}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {certs.length > 0 && (
                  <Section title="자격증">
                    <div className="flex flex-wrap gap-1.5">
                      {certs.map((c, i) => (
                        <span
                          key={i}
                          className="text-[12px] px-2.5 py-0.5 rounded-full border border-neutral-200 text-neutral-700"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </Section>
                )}

                {a.introduction && (
                  <Section title="자기소개">
                    <p className="text-[13px] text-neutral-700 whitespace-pre-line leading-relaxed">
                      {a.introduction}
                    </p>
                  </Section>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Check, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

// placeholder key → profiles column (direct)
const PROFILE_COLS: Record<string, string> = {
  business_name: "business_name",
  representative_name: "display_name",
  location: "location",
  phone_business: "phone_business",
  phone_mobile: "phone_mobile",
  opening_date: "opening_date",
  employees_count: "employees_count",
  industry_code: "industry_code",
  email: "email",
  industry_type: "business_type",
};

// placeholder key → profile_meta JSONB key
const META_COLS: Record<string, string> = {
  industry_item: "industry_item",
  cyber_mall_name: "cyber_mall_name",
  cyber_mall_domain: "cyber_mall_domain",
  owned_area: "owned_area",
  rented_area: "rented_area",
  landlord_name: "landlord_name",
  landlord_reg_no: "landlord_reg_no",
  lease_period: "lease_period",
  lease_deposit: "lease_deposit",
  lease_monthly: "lease_monthly",
  own_capital: "own_capital",
  borrowed_capital: "borrowed_capital",
  business_reg_no: "business_reg_no",
  internet_domain: "internet_domain",
  host_server_location: "host_server_location",
};

// 폼 레이블 → placeholder key (세 종류 신청서 모두 포함)
const LABEL_TO_KEY: Record<string, string> = {
  // 사업자등록 신청서
  "상호(단체명)": "business_name",
  "성명(대표자)": "representative_name",
  "사업장(단체) 소재지": "location",
  "사업장 전화번호": "phone_business",
  휴대전화번호: "phone_mobile",
  개업일: "opening_date",
  "종업원 수": "employees_count",
  업태: "industry_type",
  종목: "industry_item",
  "업종 코드": "industry_code",
  "사이버몰 명칭": "cyber_mall_name",
  "사이버몰 도메인": "cyber_mall_domain",
  자가: "owned_area",
  타가: "rented_area",
  "임대인 성명(법인명)": "landlord_name",
  "사업자(주민)등록번호": "landlord_reg_no",
  "임대차 계약기간": "lease_period",
  "(전세)보증금": "lease_deposit",
  "월세(차임)": "lease_monthly",
  자기자금: "own_capital",
  타인자금: "borrowed_capital",
  "본인 성명": "representative_name",
  전자우편주소: "email",
  // 통신판매업 신고서
  "법인명(상호)": "business_name",
  소재지: "location",
  성명: "representative_name",
  주소: "location",
  사업자등록번호: "business_reg_no",
  "인터넷 도메인 이름": "internet_domain",
  "호스트서버 소재지": "host_server_location",
};

type FormItem = {
  label: string;
  value: string; // 기존 채워진 값 (또는 빈 문자열)
  placeholderKey: string | null;
  wasPlaceholder: boolean; // true = 원래 {{...}} 미입력, false = LLM이 채운 기존값
};

type FormSection = {
  title: string;
  items: FormItem[];
};

const parsePlaceholderKey = (cell: string): string | null => {
  const m = cell.trim().match(/^\{\{(.+)\}\}$/);
  return m ? m[1] : null;
};

const resolveItem = (label: string, rawVal: string): FormItem => {
  const placeholderKey = parsePlaceholderKey(rawVal);
  if (placeholderKey) {
    return { label, value: "", placeholderKey, wasPlaceholder: true };
  }
  // LLM이 채운 기존값 — 레이블로 역매핑
  const inferredKey = LABEL_TO_KEY[label] ?? null;
  return {
    label,
    value: rawVal,
    placeholderKey: inferredKey,
    wasPlaceholder: false,
  };
};

const parseForm = (content: string): FormSection[] => {
  const sections: FormSection[] = [];
  let current: FormSection | null = null;
  let headers: string[] = [];
  let prevLineWasTable = false;

  for (const raw of content.split("\n")) {
    const line = raw.trim();

    if (line.startsWith("📝") || line.includes("직접 채워야 할 항목")) break;

    if (line.startsWith("## ")) {
      current = { title: line.slice(3).trim(), items: [] };
      sections.push(current);
      headers = [];
      prevLineWasTable = false;
      continue;
    }

    if (!current) continue;

    if (!line.startsWith("|")) {
      prevLineWasTable = false;
      headers = [];
      continue;
    }

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .slice(1, -1);

    if (cells.every((c) => /^[-:]+$/.test(c) || c === "")) continue;

    if (!prevLineWasTable) {
      headers = cells;
      prevLineWasTable = true;
      continue;
    }

    const isLabelValueTable =
      headers.some((h) => h === "항목") && headers.some((h) => h === "내용");

    if (isLabelValueTable) {
      for (let i = 0; i + 1 < cells.length; i += 2) {
        const label = cells[i];
        const rawVal = cells[i + 1] ?? "";
        if (!label) continue;
        current.items.push(resolveItem(label, rawVal));
      }
    } else {
      headers.forEach((header, idx) => {
        if (!header || idx >= cells.length) return;
        const rawVal = cells[idx] ?? "";
        const key = parsePlaceholderKey(rawVal);
        if (!rawVal && !key) return;
        current!.items.push(resolveItem(header, rawVal));
      });
    }
  }

  return sections.filter((s) => s.items.length > 0);
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Props = {
  content: string;
  title: string;
  accountId: string;
  applicationType?: string;
  onDocxReady?: (url: string) => void;
};
type SaveState = "idle" | "saving" | "saved";

export const AdminApplicationCard = ({
  content,
  title,
  accountId,
  applicationType = "business_registration",
  onDocxReady,
}: Props) => {
  const [sections] = useState<FormSection[]>(() => parseForm(content));

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    parseForm(content).forEach((sec) =>
      sec.items.forEach((item) => {
        const key = item.placeholderKey ?? item.label;
        init[key] = item.value;
      }),
    );
    return init;
  });

  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 프로필 데이터로 빈 placeholder 초기값 채우기
  useEffect(() => {
    const sb = createClient();
    sb.from("profiles")
      .select(
        "business_name,display_name,business_type,location,employees_count," +
          "phone_mobile,phone_business,email,opening_date,industry_code,profile_meta",
      )
      .eq("id", accountId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const row = data as unknown as Record<string, unknown>;
        const meta: Record<string, string> =
          (row.profile_meta as Record<string, string>) ?? {};
        const profileValues: Record<string, string> = {
          business_name: String(row.business_name ?? ""),
          representative_name: String(row.display_name ?? ""),
          phone_business: String(row.phone_business ?? ""),
          phone_mobile: String(row.phone_mobile ?? ""),
          location: String(row.location ?? ""),
          opening_date: String(row.opening_date ?? ""),
          employees_count: String(row.employees_count ?? ""),
          industry_code: String(row.industry_code ?? ""),
          industry_type: String(row.business_type ?? ""),
          email: String(row.email ?? ""),
          industry_item: meta.industry_item ?? "",
          cyber_mall_name: meta.cyber_mall_name ?? "",
          cyber_mall_domain: meta.cyber_mall_domain ?? "",
          owned_area: meta.owned_area ?? "",
          rented_area: meta.rented_area ?? "",
          landlord_name: meta.landlord_name ?? "",
          landlord_reg_no: meta.landlord_reg_no ?? "",
          lease_period: meta.lease_period ?? "",
          lease_deposit: meta.lease_deposit ?? "",
          lease_monthly: meta.lease_monthly ?? "",
          own_capital: meta.own_capital ?? "",
          borrowed_capital: meta.borrowed_capital ?? "",
        };
        setValues((prev) => {
          const merged: Record<string, string> = { ...prev };
          for (const [k, v] of Object.entries(profileValues)) {
            if (v && !merged[k]) merged[k] = v;
          }
          return merged;
        });
      });
  }, [accountId]);

  useEffect(() => {
    const sb = createClient();
    sb.from("artifacts")
      .select("id")
      .eq("account_id", accountId)
      .eq("type", "admin_application")
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setArtifactId((data as { id: string }).id);
      });
  }, [accountId]);

  const rebuildContent = (currentValues: Record<string, string>) => {
    let result = content;
    sections.forEach((sec) =>
      sec.items.forEach((item) => {
        const stateKey = item.placeholderKey ?? item.label;
        const newVal = currentValues[stateKey];
        if (newVal === undefined) return;
        if (item.wasPlaceholder && item.placeholderKey) {
          result = result.replace(
            new RegExp(`\\{\\{${escapeRegex(item.placeholderKey)}\\}\\}`, "g"),
            newVal || `{{${item.placeholderKey}}}`,
          );
        } else if (item.value && item.value !== newVal) {
          result = result.replace(item.value, newVal);
        }
      }),
    );
    return result;
  };

  const saveAll = async (currentValues: Record<string, string>) => {
    setSaveState("saving");
    const sb = createClient();
    const tasks: PromiseLike<unknown>[] = [];

    if (artifactId) {
      tasks.push(
        fetch(`${API_BASE}/api/artifacts/${artifactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            content: rebuildContent(currentValues),
          }),
        }),
      );
    }

    // profiles 직접 컬럼 일괄 업데이트
    const profilePatch: Record<string, string> = {};
    // profile_meta는 키별로 모아서 한 번에 업데이트
    const metaPatch: Record<string, string> = {};

    sections.forEach((sec) =>
      sec.items.forEach((item) => {
        const stateKey = item.placeholderKey ?? item.label;
        const val = (currentValues[stateKey] ?? "").trim();
        if (!val || val === item.value) return;
        if (PROFILE_COLS[stateKey]) profilePatch[PROFILE_COLS[stateKey]] = val;
        else if (META_COLS[stateKey]) metaPatch[META_COLS[stateKey]] = val;
      }),
    );

    if (Object.keys(profilePatch).length > 0) {
      tasks.push(
        sb.from("profiles").update(profilePatch).eq("id", accountId).then(),
      );
    }

    if (Object.keys(metaPatch).length > 0) {
      tasks.push(
        sb
          .from("profiles")
          .select("profile_meta")
          .eq("id", accountId)
          .single()
          .then(({ data }) => {
            const meta = {
              ...((data as { profile_meta: Record<string, unknown> } | null)
                ?.profile_meta ?? {}),
              ...metaPatch,
            };
            return sb
              .from("profiles")
              .update({ profile_meta: meta })
              .eq("id", accountId)
              .then();
          }),
      );
    }

    await Promise.all(tasks).catch(() => {});

    // Generate filled DOCX and deliver download link via callback
    if (onDocxReady) {
      try {
        const allFields: Record<string, string> = {};
        sections.forEach((sec) =>
          sec.items.forEach((item) => {
            const stateKey = item.placeholderKey ?? item.label;
            const val = (currentValues[stateKey] ?? item.value ?? "").trim();
            if (val) allFields[stateKey] = val;
          }),
        );
        const docxRes = await fetch(
          `${API_BASE}/api/docx/business-registration`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account_id: accountId,
              doc_type: applicationType,
              fields: allFields,
            }),
          },
        );
        if (docxRes.ok) {
          const blob = await docxRes.blob();
          const url = URL.createObjectURL(blob);
          onDocxReady(url);
        }
      } catch {
        // DOCX failure is non-fatal; save still succeeded
      }
    }

    setSaveState("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState("idle"), 2000);
  };

  return (
    <div className="w-full rounded-[5px] border border-[#ddd0b4] bg-[#faf8f4] text-[13px] overflow-hidden">
      <div className="px-3 py-2 border-b border-[#ddd0b4] bg-[#f0ebe0]">
        <span className="font-semibold text-[#030303]/80">{title}</span>
      </div>

      {sections.map((section, si) => (
        <div key={si}>
          <div className="px-3 py-1 bg-[#ede8dc] text-[11px] font-semibold text-[#030303]/55 tracking-wide">
            {section.title}
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {section.items.map((item, ii) => (
                <tr
                  key={ii}
                  className="border-b border-[#e8e2d4] last:border-0"
                >
                  <td className="px-3 py-1.5 w-[38%] text-[12px] text-[#030303]/50 bg-[#f5f1ea] align-middle whitespace-nowrap">
                    {item.label}
                  </td>
                  <td className="px-2 py-1 align-middle">
                    {(() => {
                      const stateKey = item.placeholderKey ?? item.label;
                      return (
                        <input
                          type="text"
                          value={values[stateKey] ?? ""}
                          placeholder="직접 입력"
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [stateKey]: e.target.value,
                            }))
                          }
                          className="w-full rounded-[3px] border border-[#ddd0b4] bg-[#fffdf7] px-2 py-0.5 text-[13px] placeholder:text-[#030303]/25 focus:outline-none focus:ring-1 focus:ring-[#4a7c59]"
                        />
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="px-3 py-2.5 border-t border-[#ddd0b4] bg-[#f7f4ef]">
        <button
          onClick={() => saveAll(values)}
          disabled={saveState === "saving"}
          className="flex items-center gap-1.5 rounded-[5px] bg-[#4a7c59] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#3d6a4a] disabled:opacity-50"
        >
          {saveState === "saving" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              저장 중…
            </>
          ) : saveState === "saved" ? (
            <>
              <Check className="h-3.5 w-3.5" />
              저장됨
            </>
          ) : (
            "저장"
          )}
        </button>
      </div>
    </div>
  );
};

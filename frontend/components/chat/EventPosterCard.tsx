"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export type EventPosterPayload = {
  artifact_id: string;
  title: string;
  html?: string;
  public_url?: string;
};

const EVENT_POSTER_RE = /\[\[EVENT_POSTER\]\]([\s\S]*?)\[\[\/EVENT_POSTER\]\]/g;

export function extractEventPosterPayload(text: string): {
  cleaned: string;
  payload: EventPosterPayload | null;
  payloads: EventPosterPayload[];
} {
  const payloads: EventPosterPayload[] = [];
  let cleaned = text;
  let m: RegExpExecArray | null;
  const re = new RegExp(EVENT_POSTER_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    try {
      const p = JSON.parse(m[1]) as EventPosterPayload;
      payloads.push(p);
    } catch {
      /* ignore */
    }
    cleaned = cleaned.replace(m[0], "");
  }
  cleaned = cleaned.trim();
  return { cleaned, payload: payloads[0] ?? null, payloads };
}

const resolveUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith("/")) {
    const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
    return `${base}${url}`;
  }
  return url;
};

export function EventPosterCard({ payload }: { payload: EventPosterPayload }) {
  const [downloading, setDownloading] = useState(false);
  const resolvedUrl = resolveUrl(payload.public_url);

  const handleDownload = () => {
    if (!resolvedUrl) return;
    setDownloading(true);
    const a = document.createElement("a");
    a.href = resolvedUrl;
    const filename = (payload.title || "event-poster")
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 100);
    a.download = `${filename}.html`;
    a.target = "_blank";
    a.click();
    setDownloading(false);
  };

  if (!resolvedUrl && !payload.html) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
        <span className="text-[13px] font-medium text-neutral-800 truncate mr-3">
          {payload.title || "이벤트 포스터"}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="flex-shrink-0 flex items-center gap-1.5 h-7 text-[12px] px-2.5"
          onClick={handleDownload}
          disabled={downloading || !resolvedUrl}
        >
          <Download className="h-3.5 w-3.5" />
          HTML 저장
        </Button>
      </div>
      <div className="w-full bg-neutral-50 p-4">
        {resolvedUrl ? (
          <iframe
            src={resolvedUrl}
            title={payload.title || "이벤트 포스터"}
            className="w-full rounded border border-neutral-200 bg-white"
            style={{ height: "620px" }}
          />
        ) : (
          <iframe
            srcDoc={payload.html}
            title={payload.title || "이벤트 포스터"}
            className="w-full rounded border border-neutral-200 bg-white"
            style={{ height: "620px" }}
            sandbox="allow-same-origin"
          />
        )}
      </div>
    </div>
  );
}

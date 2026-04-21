"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X, Trash2, CheckCircle2, Loader2, ImagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Photo = {
  id: string;
  public_url: string;
  name: string;
  size_bytes: number;
  created_at: string;
};

type Props = {
  aiImageUrl: string;          // DALL-E 생성 이미지 (기본 선택)
  onSelect: (url: string) => void;
  onClose: () => void;
};

export const PhotoLibraryModal = ({ aiImageUrl, onSelect, onClose }: Props) => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState(aiImageUrl);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const getAccountId = async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? "";
  };

  const fetchPhotos = useCallback(async () => {
    const accountId = await getAccountId();
    const res = await fetch(`${apiBase}/api/marketing/photos?account_id=${accountId}`);
    const json = await res.json();
    setPhotos(json.data ?? []);
    setLoading(false);
  }, [apiBase]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const accountId = await getAccountId();
      const form = new FormData();
      form.append("account_id", accountId);
      form.append("file", file);
      const res = await fetch(`${apiBase}/api/marketing/photos/upload`, {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      await fetchPhotos();
      // 방금 업로드한 사진 자동 선택
      setSelectedUrl(json.data.public_url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "업로드 실패");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (photo: Photo) => {
    if (!confirm(`"${photo.name}" 사진을 삭제할까요?`)) return;
    setDeletingId(photo.id);
    try {
      const accountId = await getAccountId();
      await fetch(
        `${apiBase}/api/marketing/photos/${photo.id}?account_id=${accountId}`,
        { method: "DELETE" },
      );
      if (selectedUrl === photo.public_url) setSelectedUrl(aiImageUrl);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-xl flex-col rounded-2xl bg-[#fbf6eb] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#ddd0b4] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-[#2e2719]">사진 라이브러리</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 hover:bg-[#f0ece4]"
          >
            <X className="h-5 w-5 text-[#8c7e66]" />
          </button>
        </div>

        {/* 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto p-5" style={{ maxHeight: "65vh" }}>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[#8c7e66]" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {/* AI 이미지 */}
              {aiImageUrl && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSelectedUrl(aiImageUrl)}
                    className={`relative w-full overflow-hidden rounded-xl transition-all ${
                      selectedUrl === aiImageUrl
                        ? "ring-4 ring-[#3b7aba] ring-offset-2"
                        : "ring-2 ring-transparent hover:ring-[#3b7aba]/40 hover:ring-offset-1"
                    }`}
                  >
                    <div className="relative aspect-square w-full bg-[#f0ece4]">
                      <Image
                        src={aiImageUrl}
                        alt="AI 생성 이미지"
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    {selectedUrl === aiImageUrl && (
                      <div className="absolute right-2 top-2 rounded-full bg-[#3b7aba] p-1 shadow-md">
                        <CheckCircle2 className="h-5 w-5 text-white" strokeWidth={2.5} />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 py-1 text-center text-[11px] font-medium text-white">
                      ✨ AI 생성
                    </div>
                  </button>
                </div>
              )}

              {/* 라이브러리 사진 */}
              {photos.map((photo) => (
                <div key={photo.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setSelectedUrl(photo.public_url)}
                    className={`relative w-full overflow-hidden rounded-xl transition-all ${
                      selectedUrl === photo.public_url
                        ? "ring-4 ring-[#3b7aba] ring-offset-2"
                        : "ring-2 ring-transparent hover:ring-[#3b7aba]/40 hover:ring-offset-1"
                    }`}
                  >
                    <div className="relative aspect-square w-full bg-[#f0ece4]">
                      <Image
                        src={photo.public_url}
                        alt={photo.name}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    {selectedUrl === photo.public_url && (
                      <div className="absolute right-2 top-2 rounded-full bg-[#3b7aba] p-1 shadow-md">
                        <CheckCircle2 className="h-5 w-5 text-white" strokeWidth={2.5} />
                      </div>
                    )}
                  </button>
                  {/* 삭제 버튼 */}
                  <button
                    type="button"
                    onClick={() => handleDelete(photo)}
                    disabled={deletingId === photo.id}
                    className="absolute bottom-1.5 right-1.5 rounded-full bg-black/50 p-1 hover:bg-black/70"
                  >
                    {deletingId === photo.id ? (
                      <Loader2 className="h-3 w-3 animate-spin text-white" />
                    ) : (
                      <Trash2 className="h-3 w-3 text-white" />
                    )}
                  </button>
                </div>
              ))}

              {/* 마지막 칸: + 추가 버튼 */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[#ddd0b4] text-[#8c7e66] transition-colors hover:border-[#c47865] hover:bg-[#f0ece4] disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-7 w-7 animate-spin" />
                ) : (
                  <>
                    <span className="text-3xl font-light leading-none">+</span>
                    <span className="text-[11px]">사진 추가</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-[#ddd0b4] px-5 py-4">
          {/* 업로드 버튼 */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
          <button
            type="button"
            onClick={() => onSelect(selectedUrl)}
            disabled={!selectedUrl}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#f09433] via-[#e6683c] to-[#bc1888] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            이 사진으로 게시
          </button>
        </div>
      </div>
    </div>
  );
};

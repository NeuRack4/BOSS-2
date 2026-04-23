"use client";

/**
 * BossAvatar  — AI 답변 왼쪽 아이콘 (부장님)
 * EmployeeAvatar — 사용자 메시지 오른쪽 기본 아이콘 (직원)
 */

type AvatarProps = { size?: number };

export const BossAvatar = ({ size = 24 }: AvatarProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Boss"
  >
    {/* 배경 원 */}
    <circle cx="12" cy="12" r="12" fill="#3a4a3a" />

    {/* 얼굴 */}
    <circle cx="12" cy="10" r="4.5" fill="#d4a87c" />

    {/* 머리카락 (옆 가르마, 진한 회색) */}
    <path
      d="M7.5 9 Q7.5 5.5 12 5.5 Q16.5 5.5 16.5 9 L15.5 9 Q15 6.5 12 6.5 Q9 6.5 8.5 9Z"
      fill="#888"
    />

    {/* 안경 테 */}
    <rect
      x="8"
      y="9.5"
      width="2.8"
      height="1.8"
      rx="0.7"
      fill="none"
      stroke="#444"
      strokeWidth="0.7"
    />
    <rect
      x="13.2"
      y="9.5"
      width="2.8"
      height="1.8"
      rx="0.7"
      fill="none"
      stroke="#444"
      strokeWidth="0.7"
    />
    <line
      x1="10.8"
      y1="10.4"
      x2="13.2"
      y2="10.4"
      stroke="#444"
      strokeWidth="0.7"
    />
    <line x1="7.5" y1="10.4" x2="8" y2="10.4" stroke="#444" strokeWidth="0.7" />
    <line
      x1="16"
      y1="10.4"
      x2="16.5"
      y2="10.4"
      stroke="#444"
      strokeWidth="0.7"
    />

    {/* 입 (무표정·단호) */}
    <line
      x1="10.5"
      y1="13"
      x2="13.5"
      y2="13"
      stroke="#a0704a"
      strokeWidth="0.8"
      strokeLinecap="round"
    />

    {/* 몸 — 정장 */}
    <path d="M5 22 Q5 17 12 17 Q19 17 19 22Z" fill="#2a3a2a" />

    {/* 셔츠 & 넥타이 */}
    <path d="M10.5 17 L12 15.5 L13.5 17 L12 22Z" fill="#f0ece4" />
    <path d="M12 15.5 L11.3 18.5 L12 19.5 L12.7 18.5Z" fill="#c0392b" />
  </svg>
);

export const EmployeeAvatar = ({ size = 24 }: AvatarProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Employee"
  >
    {/* 배경 원 */}
    <circle cx="12" cy="12" r="12" fill="#7a8c6e" />

    {/* 얼굴 */}
    <circle cx="12" cy="10" r="4.5" fill="#d4a87c" />

    {/* 머리카락 (자연스러운 짧은 머리) */}
    <path
      d="M7.5 9.5 Q7.5 5.5 12 5.5 Q16.5 5.5 16.5 9.5 Q15.5 8 12 8 Q8.5 8 7.5 9.5Z"
      fill="#2a1f14"
    />

    {/* 눈 */}
    <circle cx="10.3" cy="10.2" r="0.6" fill="#2a1f14" />
    <circle cx="13.7" cy="10.2" r="0.6" fill="#2a1f14" />

    {/* 미소 */}
    <path
      d="M10.2 12.5 Q12 14 13.8 12.5"
      stroke="#a0704a"
      strokeWidth="0.8"
      fill="none"
      strokeLinecap="round"
    />

    {/* 몸 — 캐주얼 셔츠 */}
    <path d="M5 22 Q5 17 12 17 Q19 17 19 22Z" fill="#4a6a8a" />

    {/* 칼라 */}
    <path d="M10.5 17 L12 15.5 L13.5 17 L12 18.5Z" fill="#f0ece4" />
  </svg>
);

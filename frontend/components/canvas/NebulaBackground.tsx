"use client";

export const NebulaBackground = () => {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
      style={{
        background:
          "radial-gradient(ellipse 60% 45% at 25% 18%, rgba(248,220,176,0.55), transparent 70%), " +
          "radial-gradient(ellipse 55% 45% at 80% 85%, rgba(210,130,90,0.18), transparent 70%), " +
          "radial-gradient(ellipse 55% 40% at 22% 28%, rgba(196,154,58,0.08), transparent 72%), " +
          "radial-gradient(ellipse 50% 40% at 18% 82%, rgba(142,85,114,0.06), transparent 72%), " +
          "radial-gradient(ellipse 55% 40% at 82% 80%, rgba(127,143,84,0.07), transparent 72%), " +
          "linear-gradient(168deg, #f4dcb0 0%, #edc197 55%, #e0a67d 100%)",
      }}
    >
      {/* Paper grain overlay */}
      <div
        className="absolute inset-0 opacity-[0.22] mix-blend-multiply"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(140,126,102,0.35) 0.5px, transparent 1px), " +
            "radial-gradient(circle at 70% 60%, rgba(140,126,102,0.28) 0.5px, transparent 1px), " +
            "radial-gradient(circle at 40% 80%, rgba(140,126,102,0.22) 0.5px, transparent 1px)",
          backgroundSize: "3px 3px, 5px 5px, 7px 7px",
        }}
      />
    </div>
  );
};

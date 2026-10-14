import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  // Servidor Node enxuto para Docker (VPS/Cloud Run). Netlify e Vercel usam o próprio adaptador.
  ...(process.env.NEXT_OUTPUT_STANDALONE === "true" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  // Permite HMR/assets do Next quando o site é aberto via túnel (ngrok etc.)
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.loca.lt"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Links com token depois do "#": nada de Referer para outros sites. Vem depois para sobrescrever.
      ...["/convite", "/redefinir-senha"].map((source) => ({
        source,
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      })),
    ];
  },
};

export default nextConfig;

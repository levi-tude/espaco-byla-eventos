import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite HMR/assets do Next quando o site é aberto via túnel (ngrok etc.)
  allowedDevOrigins: [
    "carlyn-prothetic-cletus.ngrok-free.dev",
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.loca.lt",
  ],
};

export default nextConfig;

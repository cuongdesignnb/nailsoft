const isProduction = process.env.NODE_ENV === "production";
const scriptSource = isProduction
  ? "'self'"
  : "'self' 'unsafe-inline' 'unsafe-eval'";
const styleSource = isProduction ? "'self'" : "'self' 'unsafe-inline'";
const connectSource = isProduction
  ? "'self' " + (process.env.NEXT_PUBLIC_API_URL ?? "")
  : "'self' http://localhost:3001 ws://localhost:3001 http://127.0.0.1:3001 ws://127.0.0.1:3001";
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: `default-src 'self'; script-src ${scriptSource}; style-src ${styleSource}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data: blob:; connect-src ${connectSource}` },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

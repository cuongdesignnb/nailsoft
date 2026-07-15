export function allowedOrigins() {
  const configured = process.env.CORS_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origins =
    configured?.length
      ? configured
      : process.env.NODE_ENV === "production"
        ? []
        : ["http://localhost:3000", "http://localhost:3002"];
  if (process.env.NODE_ENV === "production" && origins.length === 0)
    throw new Error("CORS_ORIGINS is required in production");
  if (
    process.env.NODE_ENV === "production" &&
    origins.some((origin) => origin === "*")
  )
    throw new Error(
      "CORS_ORIGINS cannot contain a wildcard when credentials are enabled",
    );
  return origins;
}

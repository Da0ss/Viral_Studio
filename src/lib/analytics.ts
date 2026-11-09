// GA4 measurement IDs look like "G-ABC123XYZ". Anything else is ignored so a
// typo in the env var cannot inject markup into the page or break rendering.
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

// The site's own GA4 stream. Measurement IDs are public (they ship in the page
// HTML), so keeping it in code is safe; NEXT_PUBLIC_GA_MEASUREMENT_ID overrides it.
export const DEFAULT_GA_MEASUREMENT_ID = 'G-6WW2M0HHX1';

function normalise(value: string | undefined): string | null {
  const id = value?.trim().toUpperCase();
  return id && MEASUREMENT_ID.test(id) ? id : null;
}

/**
 * Returns the GA4 ID to load, or null to keep the page untracked.
 * An explicit NEXT_PUBLIC_GA_MEASUREMENT_ID wins. Otherwise the default ID is
 * used only on the Vercel production deployment, so local runs, tests, CI and
 * preview deployments do not send visits to the real report.
 */
export function getGaMeasurementId(
  value = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  vercelEnv = process.env.VERCEL_ENV,
): string | null {
  if (value?.trim()) return normalise(value);
  return vercelEnv === 'production' ? DEFAULT_GA_MEASUREMENT_ID : null;
}

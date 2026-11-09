// GA4 measurement IDs look like "G-ABC123XYZ". Anything else is ignored so a
// typo in the env var cannot inject markup into the page or break rendering.
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

export function getGaMeasurementId(value = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID): string | null {
  const id = value?.trim().toUpperCase();
  return id && MEASUREMENT_ID.test(id) ? id : null;
}

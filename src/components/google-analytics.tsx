import Script from 'next/script';
import { getGaMeasurementId } from '@/lib/analytics';

/**
 * Google Analytics 4. Renders nothing unless getGaMeasurementId() returns an
 * ID (Vercel production, or an explicit NEXT_PUBLIC_GA_MEASUREMENT_ID), so
 * local runs, tests and previews stay untracked.
 * Page changes inside the app are counted by GA4 "Enhanced measurement"
 * (browser history events), which is on by default for new web streams.
 */
export function GoogleAnalytics({ measurementId = getGaMeasurementId() }: { measurementId?: string | null }) {
  if (!measurementId) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${measurementId}');`}
      </Script>
    </>
  );
}

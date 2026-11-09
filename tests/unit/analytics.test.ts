import { expect, it } from 'vitest';
import { DEFAULT_GA_MEASUREMENT_ID, getGaMeasurementId } from '@/lib/analytics';

it('accepts a GA4 measurement ID and normalises case and spaces', () => {
  expect(getGaMeasurementId('G-ABC123XYZ', undefined)).toBe('G-ABC123XYZ');
  expect(getGaMeasurementId(' g-abc123xyz ', undefined)).toBe('G-ABC123XYZ');
});

it('ignores a malformed env value instead of falling back', () => {
  expect(getGaMeasurementId('UA-12345-1', 'production')).toBeNull();
  expect(getGaMeasurementId("G-ABC');alert(1);//", 'production')).toBeNull();
});

it('uses the site ID only on the Vercel production deployment', () => {
  expect(getGaMeasurementId(undefined, 'production')).toBe(DEFAULT_GA_MEASUREMENT_ID);
  expect(getGaMeasurementId('', 'production')).toBe(DEFAULT_GA_MEASUREMENT_ID);
  expect(getGaMeasurementId(undefined, 'preview')).toBeNull();
  expect(getGaMeasurementId(undefined, undefined)).toBeNull();
});

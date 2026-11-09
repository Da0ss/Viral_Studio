import { expect, it } from 'vitest';
import { getGaMeasurementId } from '@/lib/analytics';

it('accepts a GA4 measurement ID and normalises case and spaces', () => {
  expect(getGaMeasurementId('G-ABC123XYZ')).toBe('G-ABC123XYZ');
  expect(getGaMeasurementId(' g-abc123xyz ')).toBe('G-ABC123XYZ');
});

it('turns analytics off when the ID is missing or malformed', () => {
  expect(getGaMeasurementId(undefined)).toBeNull();
  expect(getGaMeasurementId('')).toBeNull();
  expect(getGaMeasurementId('UA-12345-1')).toBeNull();
  expect(getGaMeasurementId("G-ABC');alert(1);//")).toBeNull();
});

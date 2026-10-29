import { z } from 'zod';

// Matches the CHECK constraints on companies/warehouses.contact_phone.
export const phone = z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'Phone must be 6-20 digits, spaces, ( ) or -, optionally starting with +');

export const VENDOR_TYPES = ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR', 'BRAND', 'OTHER'];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24 hour)');
// Same-day ranges only; a store open past midnight lists two ranges on two days.
const range = z.tuple([time, time]).refine(([open, close]) => open < close, 'Opening time must be before closing time');

// {"mon": [["08:00", "13:00"], ["16:00", "22:00"]], "sun": []}. A missing day is unknown;
// an empty list is closed.
export const openingHours = z.partialRecord(z.enum(DAYS), z.array(range).max(3));

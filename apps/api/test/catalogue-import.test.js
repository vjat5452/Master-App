import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/modules/imports/csv.js';
import { MAX_IMPORT_ROWS, rupeesToMinor, validateRows } from '../src/modules/imports/catalogue-import.js';
import { openingHours, phone } from '../src/shared/vendor-fields.js';

const rows = (text) => parseCsv(text).rows;

test('CSV parser handles quotes, escaped quotes, CRLF, BOM and blank lines', () => {
  const parsed = rows('﻿sku,name\r\n"A,1","say ""hi"""\r\n\r\nB,"two\nlines"\n');
  assert.deepEqual(parsed, [
    { line: 1, cells: ['sku', 'name'] },
    { line: 2, cells: ['A,1', 'say "hi"'] },
    { line: 4, cells: ['B', 'two\nlines'] },
  ]);
  assert.deepEqual(rows('a,b'), [{ line: 1, cells: ['a', 'b'] }]);
  assert.deepEqual(rows('a,,c\n'), [{ line: 1, cells: ['a', '', 'c'] }]);
});

test('CSV parser rejects broken quoting with a line number', () => {
  assert.throws(() => parseCsv('sku\n"open'), /line 2: unterminated/);
  assert.throws(() => parseCsv('sku\nab"c"'), /line 2: unexpected quote/);
});

test('rupees convert to paise without floating point error', () => {
  assert.equal(rupeesToMinor('45'), 4500);
  assert.equal(rupeesToMinor('45.5'), 4550);
  assert.equal(rupeesToMinor('0.29'), 29);
  assert.equal(rupeesToMinor('1234567.89'), 123456789);
});

test('valid rows are normalized', () => {
  const { rows: valid, errors } = validateRows(
    rows('SKU,Barcode,Price,MRP,Warehouse,Quantity\nA-1,8901063010116,45.50,50,Main store,12\nA-2,8901063010123,10,,,\n'),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(valid, [
    { line: 2, sku: 'A-1', barcode: '8901063010116', variantId: null, priceMinor: 4550, mrpMinor: 5000, warehouse: 'Main store', quantity: 12 },
    { line: 3, sku: 'A-2', barcode: '8901063010123', variantId: null, priceMinor: 1000, mrpMinor: null, warehouse: null, quantity: null },
  ]);
});

test('header problems are reported before any row', () => {
  const { errors } = validateRows(rows('sku,colour\nA,red\n'));
  const messages = errors.map((e) => e.message).join(' | ');
  assert.match(messages, /Unknown column\(s\): colour/);
  assert.match(messages, /Missing required column "price"/);
  assert.match(messages, /barcode" or a "variant_id/);
  assert.match(validateRows([]).errors[0].message, /empty/);
  assert.match(validateRows(rows('sku,barcode,price\n')).errors[0].message, /No data rows/);
});

test('every bad field is reported with its line and column', () => {
  const { errors } = validateRows(
    rows(
      [
        'sku,barcode,variant_id,price,mrp,warehouse,quantity',
        ',123,not-a-uuid,12.345,abc,,5',
        'B,8901063010116,,50,40,,',
        'C,,,10,,W1,-3',
        'D,8901063010116,,10,,,,extra',
      ].join('\n'),
    ),
  );
  const at = (line) => errors.filter((e) => e.line === line).map((e) => e.column ?? '-').sort();
  assert.deepEqual(at(2), ['barcode', 'mrp', 'price', 'sku', 'variant_id', 'warehouse']);
  assert.deepEqual(at(3), ['mrp']);
  assert.deepEqual(at(4), ['barcode', 'quantity']);
  assert.deepEqual(at(5), ['-']);
});

test('row limit is enforced', () => {
  const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `S${i},8901063010116,1`).join('\n');
  const { errors } = validateRows(rows(`sku,barcode,price\n${body}`));
  assert.match(errors[0].message, /At most/);
});

test('store contact and opening hours validation', () => {
  assert.equal(phone.safeParse('+91 98100-12345').success, true);
  assert.equal(phone.safeParse('call me').success, false);
  assert.equal(openingHours.safeParse({ mon: [['08:00', '13:00'], ['16:00', '22:00']], sun: [] }).success, true);
  assert.equal(openingHours.safeParse({ mon: [['22:00', '08:00']] }).success, false, 'closing before opening');
  assert.equal(openingHours.safeParse({ mon: [['8:00', '13:00']] }).success, false, 'HH:MM only');
  assert.equal(openingHours.safeParse({ monday: [] }).success, false, 'unknown day');
});

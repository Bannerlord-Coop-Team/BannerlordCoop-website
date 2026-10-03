import assert from 'node:assert/strict';
import test from 'node:test';
import { serverLogDownloadHeaders } from './server-log-contract';

// Builds valid transport headers while allowing one validation input to vary.
function headers(overrides: Record<string, string> = {}) {
  return new Headers({
    'content-type': 'application/octet-stream',
    'content-disposition': 'attachment; filename="server.log"',
    'content-length': '3',
    ...overrides,
  });
}

// Matrix: accepted transport values unchanged; rejected headers use the selected diagnostic.
test('valid filenames and byte counts are unchanged with injected diagnostics', () => {
  const value = headers({ 'content-disposition': "attachment; filename*=UTF-8''user%20name.log" });
  assert.deepEqual(serverLogDownloadHeaders(value, 'localized invalid'), { filename: 'user name.log', byteSize: 3 });
});

const invalidHeaders: Record<string, string>[] = [
  { 'content-type': 'text/plain' },
  { 'content-disposition': 'attachment; filename="../server.log"' },
  { 'content-length': '104857601' },
  { 'content-length': '-1' },
];
for (const override of invalidHeaders) {
  test(`invalid header ${JSON.stringify(override)} retains validation and default diagnostic`, () => {
    assert.throws(() => serverLogDownloadHeaders(headers(override)), { message: 'Invalid log download' });
    assert.throws(() => serverLogDownloadHeaders(headers(override), 'localized invalid'), { message: 'localized invalid' });
  });
}

test('malformed encoded filenames retain URI decoding failure semantics', () => {
  assert.throws(() => serverLogDownloadHeaders(headers({ 'content-disposition': "attachment; filename*=UTF-8''%zz.log" }), 'localized invalid'), URIError);
});

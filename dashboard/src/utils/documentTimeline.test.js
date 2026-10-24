import test from 'node:test';
import assert from 'node:assert/strict';
import { getTimelineEventLabel } from './documentTimeline.js';

test('timeline uses clear labels for known workflow actions', () => {
  assert.equal(getTimelineEventLabel({ action: 'transmission_received' }), 'Received at office');
  assert.equal(getTimelineEventLabel({ action: 'document_scanned' }), 'Document scanned');
});

test('timeline preserves a descriptive label and humanizes unknown action keys', () => {
  assert.equal(getTimelineEventLabel({ label: 'Forwarded to Agriculture', action: 'transmission_created' }), 'Forwarded to Agriculture');
  assert.equal(getTimelineEventLabel({ action: 'custom_review_completed' }), 'Custom review completed');
});

test('timeline omits machine identifiers when no usable event label exists', () => {
  assert.equal(getTimelineEventLabel({ action: '   ' }), 'Document update');
  assert.equal(getTimelineEventLabel({ action: 'TRN-12345' }), 'Document update');
});

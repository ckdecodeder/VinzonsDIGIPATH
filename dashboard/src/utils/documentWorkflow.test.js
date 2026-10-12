import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAcknowledgeDocument,
  canArchiveDocument,
  canRejectDocument,
  canSignDocument,
  canTakeDocumentAction,
  isOfficeReadOnlyTracking,
} from './documentActionRules.js';

const approvalUser = { role: 'Mayor', officeId: 'OFF-001' };

test('Mayor actions require current custody', () => {
  const doc = { status: 'For Signing', intakeStatus: 'Approved', currentOfficeId: 'OFF-008' };
  assert.equal(canTakeDocumentAction(doc, approvalUser), false);
  assert.equal(canSignDocument(doc, approvalUser), false);
  assert.equal(canAcknowledgeDocument(doc, approvalUser), false);
});

test('completed documents cannot be signed, acknowledged, or rejected again', () => {
  const doc = { status: 'Acknowledged', intakeStatus: 'Approved', currentOfficeId: 'OFF-001' };
  assert.equal(canSignDocument(doc, approvalUser), false);
  assert.equal(canAcknowledgeDocument(doc, approvalUser), false);
  assert.equal(canRejectDocument(doc, approvalUser), false);
  assert.equal(canArchiveDocument(doc, approvalUser), true);
});

test('office-originated documents outside office custody are tracking-only', () => {
  assert.equal(isOfficeReadOnlyTracking(
    { originOfficeId: 'OFF-008', currentOfficeId: 'OFF-001' },
    { role: 'Office', officeId: 'OFF-008' },
  ), true);
});

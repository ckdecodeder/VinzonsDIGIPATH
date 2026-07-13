export const getWorkflowStatus = (value) => {
  const status = typeof value === 'string' ? value : value?.status;
  if (status === 'For Signature') return 'For Signing';
  if (status === 'Acknoweledged') return 'Acknowledged';
  return status || 'Received';
};

const ROUTING_STEP = { id: 'routed', label: 'Sent to Office' };

export const hasUsedOfficeRouting = (doc, { hasPendingTransmission = false } = {}) => {
  if (hasPendingTransmission) return true;
  if (getWorkflowStatus(doc) === 'In Transit') return true;
  if (doc?.lastRoutedAt) return true;
  return (doc?.timeline || []).some((event) => (
    /routed|transit|transmission/i.test(`${event.label || ''} ${event.details || ''}`)
  ));
};

const insertRoutingStep = (steps, anchorId, usedRouting) => {
  if (!usedRouting || steps.some((step) => step.id === 'routed')) {
    return steps;
  }

  const anchorIndex = steps.findIndex((step) => step.id === anchorId);
  if (anchorIndex === -1) return steps;

  const next = [...steps];
  next.splice(anchorIndex + 1, 0, ROUTING_STEP);
  return next;
};

export const getDocumentActionLabel = (doc, options = {}) => {
  const intakeStatus = doc?.intakeStatus || 'Approved';
  const status = getWorkflowStatus(doc);

  if (intakeStatus === 'Pending Review') return 'Pending Review';
  if (intakeStatus === 'Rejected') return 'Rejected';

  if (status === 'In Transit' || options.hasPendingTransmission) {
    return 'Sent to Office';
  }

  if (status === 'Archived') {
    const before = getWorkflowStatus(doc?.statusBeforeArchive || 'Released');
    if (before === 'Acknowledged') return 'Released';
    if (before === 'Signed') return 'Signed';
    if (before === 'For Signing') return 'Signing';
    if (before === 'For Filing') return 'Filing';
    return 'Released';
  }

  const actionLabels = {
    'For Signing': 'Signing',
    'For Filing': 'Filing',
    Acknowledged: 'Released',
  };

  return actionLabels[status] || status;
};

// Custody flow: sender → receptionist → mayor → receptionist → sender
// Optional office routing when the file is sent to another office.
const WORKFLOW_FLOWS = {
  signing: [
    { id: 'submitted', label: 'Submitted' },
    { id: 'pending_review', label: 'Pending Review' },
    { id: 'approved', label: 'Approved' },
    { id: 'received', label: 'Received' },
    { id: 'for_signing', label: 'Signing' },
    { id: 'signed', label: 'Signed' },
    { id: 'acknowledged', label: 'Released' },
  ],
  filing: [
    { id: 'submitted', label: 'Submitted' },
    { id: 'pending_review', label: 'Pending Review' },
    { id: 'approved', label: 'Approved' },
    { id: 'for_filing', label: 'Filing' },
    { id: 'acknowledged', label: 'Released' },
  ],
  acknowledge_only: [
    { id: 'submitted', label: 'Submitted' },
    { id: 'pending_review', label: 'Pending Review' },
    { id: 'approved', label: 'Approved' },
    { id: 'received', label: 'Received' },
    { id: 'acknowledged', label: 'Released' },
  ],
  rejected: [
    { id: 'submitted', label: 'Submitted' },
    { id: 'pending_review', label: 'Pending Review' },
    { id: 'rejected', label: 'Rejected' },
  ],
};

const ROUTING_ANCHORS = {
  signing: 'received',
  acknowledge_only: 'received',
  filing: 'approved',
};

const getWorkflowFlowKey = (doc, status) => {
  const intakeStatus = doc?.intakeStatus || 'Approved';
  if (intakeStatus === 'Rejected') return 'rejected';

  const effectiveStatus = status === 'Archived'
    ? getWorkflowStatus(doc?.statusBeforeArchive || 'Received')
    : status;

  if (effectiveStatus === 'Acknowledged') {
    const registrationStatus = getWorkflowStatus(doc);
    if (registrationStatus === 'For Filing') return 'filing';
    if (['For Signing', 'Signed'].includes(registrationStatus)) return 'signing';
    return 'acknowledge_only';
  }

  if (effectiveStatus === 'For Filing') return 'filing';
  if (['For Signing', 'Signed'].includes(effectiveStatus)) return 'signing';

  const registrationStatus = getWorkflowStatus(doc);
  if (registrationStatus === 'For Filing') return 'filing';
  if (registrationStatus === 'For Signing') return 'signing';

  return 'signing';
};

const buildFlowSteps = (flowKey, doc, options) => {
  const baseSteps = WORKFLOW_FLOWS[flowKey];
  const usedRouting = hasUsedOfficeRouting(doc, options);
  const anchorId = ROUTING_ANCHORS[flowKey];
  return anchorId ? insertRoutingStep(baseSteps, anchorId, usedRouting) : baseSteps;
};

const getTerminalStepId = (flowKey, doc, status) => {
  const before = getWorkflowStatus(doc?.statusBeforeArchive || status);
  if (before === 'Acknowledged') return 'acknowledged';
  if (before === 'Signed') return 'signed';
  if (before === 'For Signing') return 'for_signing';
  if (before === 'For Filing') return 'for_filing';
  if (flowKey === 'filing') return 'for_filing';
  if (flowKey === 'acknowledge_only') return 'acknowledged';
  return 'signed';
};

const getActiveStepId = (doc, intakeStatus, status, options) => {
  if (intakeStatus === 'Pending Review') return 'pending_review';
  if (intakeStatus === 'Rejected') return 'rejected';

  if (status === 'In Transit' || options.hasPendingTransmission) return 'routed';

  if (status === 'Archived') {
    return getTerminalStepId(getWorkflowFlowKey(doc, status), doc, status);
  }

  if (status === 'Acknowledged') return 'acknowledged';
  if (status === 'Signed') return 'signed';
  if (status === 'For Filing') return 'for_filing';
  if (status === 'For Signing') return 'for_signing';
  if (status === 'Received' || status === 'Processing') return 'received';
  if (intakeStatus === 'Approved') return 'approved';

  return 'submitted';
};

const shouldSkipStep = (step, doc, status) => {
  if (step.id === 'acknowledged') {
    if (status === 'Archived') {
      const before = getWorkflowStatus(doc?.statusBeforeArchive || 'Received');
      return before === 'Signed' || before === 'For Signing';
    }
    if (status === 'Signed') return true;
  }

  return false;
};

const markStepStates = (steps, activeStepId, intakeStatus, doc, status) => {
  const activeIndex = steps.findIndex((step) => step.id === activeStepId);

  return steps.map((step, index) => {
    if (step.id === 'rejected' && intakeStatus === 'Rejected') {
      return { ...step, state: 'rejected' };
    }

    if (shouldSkipStep(step, doc, status)) {
      return { ...step, state: 'skipped' };
    }

    if (status === 'Archived') {
      return { ...step, state: 'done' };
    }

    if (activeIndex === -1) {
      return { ...step, state: index === 0 ? 'active' : 'upcoming' };
    }

    if (index < activeIndex) {
      return { ...step, state: 'done' };
    }

    if (index === activeIndex) {
      return { ...step, state: 'active' };
    }

    return { ...step, state: 'upcoming' };
  });
};

export const getDocumentPipelineSteps = (doc, options = {}) => {
  const intakeStatus = doc?.intakeStatus || 'Approved';
  const status = getWorkflowStatus(doc);
  const flowKey = getWorkflowFlowKey(doc, status);
  const rawSteps = buildFlowSteps(flowKey, doc, options);
  const activeStepId = getActiveStepId(doc, intakeStatus, status, options);
  const steps = markStepStates(rawSteps, activeStepId, intakeStatus, doc, status);

  const displayStatus = getDocumentActionLabel(doc, options);
  const activeIndex = steps.findIndex((step) => step.state === 'active' || step.state === 'rejected');

  return {
    steps,
    activeIndex,
    status,
    intakeStatus,
    displayStatus,
    currentStep: steps[activeIndex >= 0 ? activeIndex : steps.length - 1],
  };
};

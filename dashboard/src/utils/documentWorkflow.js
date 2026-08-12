export const getWorkflowStatus = (value) => {
  const status = typeof value === 'string' ? value : value?.status;
  if (status === 'For Signature') return 'For Signing';
  if (status === 'Acknoweledged') return 'Acknowledged';
  return status || 'Received';
};

const ROUTING_STEP = { id: 'routed', label: 'Sent to Office' };

export const hasUsedOfficeRouting = (doc) => {
  if (getWorkflowStatus(doc) === 'In Transit') return true;
  if (doc?.lastRoutedAt) return true;
  if (Array.isArray(doc?.sendHistory) && doc.sendHistory.length) return true;
  return (doc?.timeline || []).some((event) => (
    /routed|transit|transmission|sent to office|document_sent/i.test(`${event.label || ''} ${event.details || ''} ${event.action || ''}`)
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

  if (intakeStatus === 'Returned to Sender' || status === 'Returned to Sender') return 'Returned to Sender';
  if (intakeStatus === 'Rejected') return 'Rejected';
  if (intakeStatus === 'Pending Review') return 'At Mayor';

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

// External: sender → receptionist → mayor → (reject) receptionist → sender
// Internal: office → send to other offices (chronological)
const WORKFLOW_FLOWS = {
  signing: [
    { id: 'submitted', label: 'Submitted' },
    { id: 'at_mayor', label: "Mayor's Office" },
    { id: 'for_signing', label: 'Signing' },
    { id: 'signed', label: 'Signed' },
    { id: 'acknowledged', label: 'Released' },
  ],
  filing: [
    { id: 'submitted', label: 'Submitted' },
    { id: 'at_mayor', label: "Mayor's Office" },
    { id: 'for_filing', label: 'Filing' },
    { id: 'acknowledged', label: 'Released' },
  ],
  acknowledge_only: [
    { id: 'submitted', label: 'Submitted' },
    { id: 'at_mayor', label: "Mayor's Office" },
    { id: 'received', label: 'Received' },
    { id: 'acknowledged', label: 'Released' },
  ],
  rejected: [
    { id: 'submitted', label: 'Submitted' },
    { id: 'at_mayor', label: "Mayor's Office" },
    { id: 'rejected', label: 'Rejected' },
    { id: 'returned', label: 'Returned to Sender' },
  ],
  internal: [
    { id: 'submitted', label: 'Registered' },
    { id: 'received', label: 'At Office' },
    { id: 'routed', label: 'Sent to Office' },
    { id: 'acknowledged', label: 'Completed' },
  ],
};

const ROUTING_ANCHORS = {
  signing: 'at_mayor',
  acknowledge_only: 'received',
  filing: 'at_mayor',
  internal: 'received',
};

const getWorkflowFlowKey = (doc, status) => {
  const intakeStatus = doc?.intakeStatus || 'Approved';
  if (intakeStatus === 'Rejected' || intakeStatus === 'Returned to Sender' || status === 'Returned to Sender') {
    return 'rejected';
  }

  if (doc?.documentDirection === 'Outgoing') return 'internal';

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

  return 'acknowledge_only';
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
  if (flowKey === 'rejected') return 'returned';
  return 'signed';
};

const getActiveStepId = (doc, intakeStatus, status, options) => {
  if (intakeStatus === 'Returned to Sender' || status === 'Returned to Sender') return 'returned';
  if (intakeStatus === 'Rejected') return 'rejected';
  if (intakeStatus === 'Pending Review') return 'at_mayor';

  if (status === 'In Transit' || options.hasPendingTransmission) return 'routed';

  if (status === 'Archived') {
    return getTerminalStepId(getWorkflowFlowKey(doc, status), doc, status);
  }

  if (status === 'Acknowledged') return 'acknowledged';
  if (status === 'Signed') return 'signed';
  if (status === 'For Filing') return 'for_filing';
  if (status === 'For Signing') return 'for_signing';
  if (status === 'Received' || status === 'Processing') {
    if (doc?.documentDirection === 'Outgoing') return 'received';
    return 'at_mayor';
  }
  if (intakeStatus === 'Approved') return 'at_mayor';

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

    if (status === 'Archived' || intakeStatus === 'Returned to Sender' || status === 'Returned to Sender') {
      return { ...step, state: index <= activeIndex || activeIndex === -1 ? 'done' : 'upcoming' };
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

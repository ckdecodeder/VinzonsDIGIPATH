import React from 'react';
import { CheckCircle2, MapPin, XCircle } from 'lucide-react';
import { getDocumentPipelineSteps, getDocumentActionLabel } from '../utils/documentWorkflow';

const DocumentWorkflowPipeline = ({
  doc,
  hasPendingTransmission = false,
  locationLabel = '',
  workflowNote = '',
}) => {
  if (!doc) return null;

  const { steps, currentStep, status, intakeStatus } = getDocumentPipelineSteps(doc, {
    hasPendingTransmission,
  });

  const statusSummary = intakeStatus === 'Pending Review'
    ? 'Waiting for intake review'
    : intakeStatus === 'Rejected'
      ? 'Rejected — needs correction and resubmission'
      : status === 'In Transit' || hasPendingTransmission
        ? 'Document is being sent to another office'
        : `Current action: ${currentStep?.label || getDocumentActionLabel(doc, { hasPendingTransmission })}`;

  return (
    <section className="document-workflow-pipeline" aria-label="Document workflow pipeline">
      <div className="document-workflow-pipeline-banner">
        <div>
          <strong>{statusSummary}</strong>
          {workflowNote && <p>{workflowNote}</p>}
        </div>
        {locationLabel && (
          <span className="document-workflow-location">
            <MapPin size={13} />
            {locationLabel}
          </span>
        )}
      </div>

      <nav className="document-workflow-track" aria-label="Workflow steps">
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            <div
              className={[
                'document-workflow-step',
                step.state === 'done' ? 'is-done' : '',
                step.state === 'active' ? 'is-active' : '',
                step.state === 'rejected' ? 'is-rejected' : '',
                step.state === 'skipped' ? 'is-skipped' : '',
              ].filter(Boolean).join(' ')}
              aria-current={step.state === 'active' || step.state === 'rejected' ? 'step' : undefined}
            >
              <div className="document-workflow-badge" aria-hidden="true">
                {step.state === 'done' ? (
                  <CheckCircle2 size={15} />
                ) : step.state === 'rejected' ? (
                  <XCircle size={15} />
                ) : (
                  index + 1
                )}
              </div>
              <span className="document-workflow-label">{step.label}</span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={[
                  'document-workflow-connector',
                  step.state === 'done' ? 'is-done' : '',
                  step.state === 'skipped' ? 'is-skipped' : '',
                ].filter(Boolean).join(' ')}
                aria-hidden="true"
              />
            )}
          </React.Fragment>
        ))}
      </nav>
    </section>
  );
};

export default DocumentWorkflowPipeline;

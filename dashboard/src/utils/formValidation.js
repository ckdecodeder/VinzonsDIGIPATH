export const validateRequiredFields = (fields) => {
  const errors = {};
  const messages = [];

  fields.forEach(({ key, label, value, when = true }) => {
    if (!when) return;
    if (!String(value ?? '').trim()) {
      const message = `${label} is required.`;
      errors[key] = message;
      messages.push(message);
    }
  });

  return {
    errors,
    messages,
    isValid: messages.length === 0,
    summary: messages.length
      ? `Please complete the required fields: ${messages.map((message) => message.replace(/ is required\.$/, '')).join(', ')}.`
      : '',
  };
};

export const clearFieldError = (errors, field) => {
  if (!errors?.[field]) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
};

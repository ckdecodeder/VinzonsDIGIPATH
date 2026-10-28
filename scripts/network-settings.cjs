// Network synchronization must not reset a deployed Pi's camera tuning.
const preservePiSetting = (content, key, value, upsert, applyTuning = false) => {
  if (!applyTuning && new RegExp(`^${key}=`, 'm').test(content)) return content;
  return upsert(content, key, value);
};
module.exports = { preservePiSetting };

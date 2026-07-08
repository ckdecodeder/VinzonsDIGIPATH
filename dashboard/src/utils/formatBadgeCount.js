const formatBadgeCount = (count) => {
  const value = Number(count) || 0;
  if (value <= 0) return '';
  if (value > 9) return '9+';
  return String(value);
};

export default formatBadgeCount;

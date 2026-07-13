const MAYORS_OFFICE_ID = 'OFF-001';
const MAYORS_OFFICE_NAME = "Mayor's Office";

const isMayorsOffice = (office) =>
  office?.name === MAYORS_OFFICE_NAME || office?.id === MAYORS_OFFICE_ID;

const roleSlotTaken = (users, role, officeId, excludeUserId = null) =>
  users.some(
    (user) =>
      user.id !== excludeUserId &&
      user.role === role &&
      user.officeId === officeId,
  );

const hasMayorAssigned = (users, excludeUserId = null) =>
  users.some(
    (user) => user.id !== excludeUserId && user.role === 'Mayor',
  );

const getAvailableRoles = ({
  offices,
  officeId,
  users,
  excludeUserId = null,
}) => {
  const office = offices.find((item) => item.id === officeId);
  const atMayorsOffice = isMayorsOffice(office);
  const roles = [];

  if (atMayorsOffice) {
    if (!hasMayorAssigned(users, excludeUserId)) {
      roles.push('Mayor');
    }
    if (!roleSlotTaken(users, 'Admin', officeId, excludeUserId)) {
      roles.push('Admin');
    }
  } else {
    roles.push('Office');
    roles.push('Receptionist');
    if (!roleSlotTaken(users, 'Admin', officeId, excludeUserId)) {
      roles.push('Admin');
    }
  }

  if (excludeUserId) {
    const editingUser = users.find((user) => user.id === excludeUserId);
    if (editingUser?.role && !roles.includes(editingUser.role)) {
      roles.unshift(editingUser.role);
    }
  }

  return roles;
};

const validateRoleAssignment = ({
  role,
  officeId,
  offices,
  users,
  excludeUserId = null,
}) => {
  const availableRoles = getAvailableRoles({
    offices,
    officeId,
    users,
    excludeUserId,
  });

  if (availableRoles.includes(role)) {
    return '';
  }

  if (role === 'Mayor') {
    const office = offices.find((item) => item.id === officeId);
    if (!isMayorsOffice(office)) {
      return "Mayor role is only available for Mayor's Office.";
    }
    return 'A Mayor has already been assigned.';
  }

  if (role === 'Admin') {
    return 'This office already has an Admin assigned.';
  }

  if (role === 'Receptionist') {
    const office = offices.find((item) => item.id === officeId);
    if (isMayorsOffice(office)) {
      return "Receptionist role is not available at Mayor's Office.";
    }
    return 'The selected role is not available for this office.';
  }

  if (role === 'Office') {
    return "Office role is not available at Mayor's Office.";
  }

  return 'The selected role is not available for this office.';
};

module.exports = {
  MAYORS_OFFICE_NAME,
  isMayorsOffice,
  roleSlotTaken,
  hasMayorAssigned,
  getAvailableRoles,
  validateRoleAssignment,
};

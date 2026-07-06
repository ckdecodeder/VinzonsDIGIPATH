const { setPresenceHandler } = require('../utils/realtime');
const { applyHardwareEvent } = require('../services/devicePresence');

setPresenceHandler(async (body, eventType, deviceId) => {
  return applyHardwareEvent(
    { ...body, deviceId: body.deviceId || body.id || deviceId },
    eventType,
    { deviceId: body.deviceId || body.id || deviceId, ip: body.ip },
  );
});

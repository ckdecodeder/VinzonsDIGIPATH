const { getRealtimeHub } = require('../ws/realtimeHub');

const getHub = () => getRealtimeHub();

const broadcastDeviceUpdated = (device) => {
  getHub()?.broadcastDeviceUpdated(device);
};

const broadcastCommandUpdated = (command, resultDocument = null) => {
  getHub()?.broadcastCommandUpdated(command, resultDocument);
};

const broadcastDataInvalidate = (collections = []) => {
  getHub()?.broadcastDataInvalidate(collections);
};

const pushCommandToDevice = (deviceId, command) => {
  return getHub()?.pushCommandToDevice(deviceId, command) || false;
};

const isDeviceWsConnected = (deviceId) => {
  return getHub()?.isDeviceConnected(deviceId) || false;
};

const setPresenceHandler = (handler) => {
  getHub()?.setPresenceHandler(handler);
};

module.exports = {
  broadcastDeviceUpdated,
  broadcastCommandUpdated,
  broadcastDataInvalidate,
  pushCommandToDevice,
  isDeviceWsConnected,
  setPresenceHandler,
};

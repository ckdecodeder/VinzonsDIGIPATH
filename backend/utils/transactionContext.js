const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const currentTransaction = () => context.getStore();
const withModelTransaction = (Model, work) => {
  const current = currentTransaction();
  if (current) return work(current);
  return Model.sequelize.transaction(tx => context.run(tx, () => work(tx)));
};
const withDeviceCommandLock = (deviceId, work, Model = require('../models')._sequelizeModels.CommandModel) => {
  return withModelTransaction(Model, async tx => {
    await Model.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:namespace), hashtext(:deviceId))', {
      replacements: { namespace: 'digipath-device-command', deviceId }, transaction: tx,
    });
    return work();
  });
};
module.exports = { currentTransaction, withModelTransaction, withDeviceCommandLock };

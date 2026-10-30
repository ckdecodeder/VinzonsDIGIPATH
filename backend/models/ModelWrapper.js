/**
 * ModelWrapper — Mongoose-to-Sequelize Compatibility Layer
 *
 * Wraps a Sequelize model so the existing route handlers can call Mongoose-style
 * methods (find, findOne, findOneAndUpdate, save, countDocuments, etc.) without
 * any changes to the route code.
 *
 * Supported Mongo operators in filter objects:
 *   $or, $and, $in, $nin, $ne, $lt, $lte, $gt, $gte, $exists, $regex
 *   $set, $push, $inc, $unset (in update objects)
 */
const { Op, Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/db');
const { currentTransaction, withModelTransaction } = require('../utils/transactionContext');

const JSONB_ARRAY_FIELDS = new Set([
  'timeline',
  'sendHistory',
  'readBy',
  'scannedFiles',
  'senderNotificationChannels',
]);

const buildJsonbArrayMatchLiteral = (jsonField, jsonKey, value) => {
  const safeKey = String(jsonKey).replace(/[^a-zA-Z0-9_]/g, '');
  if (!safeKey) return null;

  const escapedValue = sequelize
    ? sequelize.escape(String(value))
    : `'${String(value).replace(/'/g, "''")}'`;

  return Sequelize.literal(
    `EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE("${jsonField}", '[]'::jsonb)) AS json_elem WHERE json_elem->>'${safeKey}' = ${escapedValue})`,
  );
};

// ─── MongoDB operator → Sequelize Op mapping ─────────────────────────────────
const OP_MAP = {
  $eq:  Op.eq,
  $ne:  Op.ne,
  $lt:  Op.lt,
  $lte: Op.lte,
  $gt:  Op.gt,
  $gte: Op.gte,
  $in:  Op.in,
  $nin: Op.notIn,
  $like: Op.like,
  $iLike: Op.iLike,
};

/**
 * Recursively translate a MongoDB filter object into a Sequelize `where` clause.
 */
function translateFilter(filter) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return filter;

  const result = {};

  for (const [key, value] of Object.entries(filter)) {
    // Top-level logical operators
    if (key === '$or') {
      result[Op.or] = value.map(translateFilter);
      continue;
    }
    if (key === '$and') {
      result[Op.and] = value.map(translateFilter);
      continue;
    }
    if (key === '$nor') {
      result[Op.not] = { [Op.or]: value.map(translateFilter) };
      continue;
    }

    // Raw RegExp values should be translated into Sequelize regex operators.
    if (value instanceof RegExp) {
      const op = value.flags.includes('i') ? Op.iRegexp : Op.regexp;
      result[key === '_id' ? 'id' : key] = { [op]: value.source };
      continue;
    }

    // Nested condition object: { field: { $op: val } }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const hasMongoOp = Object.keys(value).some(k => k.startsWith('$'));
      if (hasMongoOp) {
        const conditions = {};
        for (const [op, operand] of Object.entries(value)) {
          if (op === '$in' && Array.isArray(operand) && operand.some(v => v === null || v === '')) {
            // $in: [null, ''] → IS NULL OR = ''
            conditions[Op.or] = [{ [Op.is]: null }, { [Op.eq]: '' }];
          } else if (OP_MAP[op]) {
            conditions[OP_MAP[op]] = operand;
          } else if (op === '$exists') {
            conditions[operand ? Op.ne : Op.is] = null;
          } else if (op === '$regex') {
            if (operand instanceof RegExp) {
              const regexOp = operand.flags.includes('i') ? Op.iRegexp : Op.regexp;
              conditions[regexOp] = operand.source;
            } else {
              conditions[Op.iLike] = operand.replace(/\.\*/g, '%').replace(/\./g, '_');
            }
          } else if (op === '$not') {
            conditions[Op.not] = translateFilter(operand);
          }
        }
        result[key === '_id' ? 'id' : key] = conditions;
        continue;
      }
    }

    // Nested dot-notation keys for JSON array columns (e.g. 'timeline.userId')
    if (key.includes('.')) {
      const [jsonField, jsonKey, ...rest] = key.split('.');
      if (!rest.length && jsonField && jsonKey && JSONB_ARRAY_FIELDS.has(jsonField)) {
        const literal = buildJsonbArrayMatchLiteral(jsonField, jsonKey, value);
        if (literal) {
          if (!result[Op.and]) {
            result[Op.and] = [literal];
          } else if (Array.isArray(result[Op.and])) {
            result[Op.and].push(literal);
          } else {
            result[Op.and] = [result[Op.and], literal];
          }
        }
      }
      continue;
    }

    result[key === '_id' ? 'id' : key] = value;
  }

  return result;
}

/**
 * Translate a MongoDB sort descriptor (e.g. { createdAt: -1, id: 1 })
 * into a Sequelize `order` array.
 */
function translateSort(sort) {
  if (!sort) return [];
  return Object.entries(sort).map(([field, dir]) => {
    const resolvedField = field === '_id' ? 'id' : field;
    return [resolvedField, dir === -1 || dir === 'desc' ? 'DESC' : 'ASC'];
  });
}

/**
 * Strip the Sequelize dataValues wrapper and return a plain JS object.
 */
function toPlain(instance) {
  if (!instance) return null;
  if (Array.isArray(instance)) return instance.map(toPlain);
  if (typeof instance.toJSON === 'function') {
    const plain = instance.toJSON();
    return plain;
  }
  return instance;
}

// ─── Instance wrapper (returned from find* methods) ───────────────────────────
class ModelInstance {
  constructor(plain, wrapper, persisted = true) {
    Object.assign(this, plain);
    Object.defineProperty(this, '_wrapper', {
      value: wrapper,
      enumerable: false,
      writable: true,
    });
    Object.defineProperty(this, '_persisted', { value: persisted, writable: true, enumerable: false });
    Object.defineProperty(this, '_identity', { value: plain.id, writable: true, enumerable: false });
    Object.defineProperty(this, '_original', { value: structuredClone(plain), writable: true, enumerable: false });
  }

  toJSON() {
    const clone = { ...this };
    delete clone._wrapper;
    return clone;
  }

  // New instances must INSERT. Existing instances must never recreate deleted records.
  async save(options = {}) {
    options = { ...(currentTransaction() ? { transaction: currentTransaction() } : {}), ...options };
    const data = { ...this };
    delete data._wrapper;

    // Hash password if it looks like it needs it
    if (data.password && !data.password.startsWith('$2')) {
      data.password = await bcrypt.hash(data.password, 10);
    }

    if (this._persisted && data.id !== this._identity) throw new Error('Record identity is immutable');
    let instance;
    if (!this._persisted) {
      // Hooks (including document/outbox writes) share the insert's transaction.
      instance = options.transaction
        ? await this._wrapper._Model.create(data, options)
        : await withModelTransaction(this._wrapper._Model, transaction => this._wrapper._Model.create(data, { ...options, transaction }));
    } else {
      instance = await withModelTransaction(this._wrapper._Model, async transaction => {
        const row = await this._wrapper._Model.findOne({ where: { id: this._identity }, transaction, lock: transaction.LOCK.UPDATE });
        if (!row) { const error = new Error('Record no longer exists'); error.status = 409; throw error; }
        const changes = Object.fromEntries(Object.entries(data).filter(([key, value]) => key !== 'id' && JSON.stringify(value) !== JSON.stringify(this._original[key])));
        await row.update(changes, { transaction });
        return row;
      });
    }
    const plain = toPlain(instance);
    Object.assign(this, plain);
    this._persisted = true;
    this._identity = this.id;
    this._original = structuredClone(plain);
    return this;
  }

  // Mongoose .matchPassword(password) for auth
  async matchPassword(password) {
    return bcrypt.compare(password, this.password);
  }

  // Mongoose .toSafeObject()
  toSafeObject() {
    const obj = { ...this };
    delete obj.password;
    delete obj._wrapper;
    return obj;
  }
}

// ─── Query builder (returned from find, sort, limit, select) ──────────────────
class QueryBuilder {
  constructor(Model, where, options = {}) {
    this._Model = Model;
    this._where = where;
    this._options = { ...options };
    this._isMany = options._isMany !== false;
    this._isLean = false;
    this._selectedFields = null;
    this._wrapper = options._wrapper;
  }

  sort(sortObj) {
    this._options.order = translateSort(sortObj);
    return this;
  }

  limit(n) {
    this._options.limit = n;
    return this;
  }

  skip(n) { this._options.offset = n; return this; }
  forUpdate() { this._options.forUpdate = true; return this; }

  withAttributes(attributes) { this._options.attributes = attributes; return this; }

  select(fields) {
    this._selectedFields = typeof fields === 'string' ? fields.trim().split(/\s+/).filter(Boolean)
      : Object.entries(fields || {}).map(([key, enabled]) => enabled ? key : `-${key}`);
    return this;
  }

  lean() {
    this._isLean = true;
    return this;
  }

  async _exec() {
    const opts = {
      where: this._where,
      ...(this._options.order ? { order: this._options.order } : {}),
      ...(this._options.limit ? { limit: this._options.limit } : {}),
      ...(this._options.offset ? { offset: this._options.offset } : {}),
      raw: false,
      ...(currentTransaction() ? { transaction: currentTransaction() } : {}),
    };
    if (this._options.forUpdate) {
      if (!opts.transaction) throw new Error('Row locking requires a transaction');
      opts.lock = opts.transaction.LOCK.UPDATE;
    }

    // By default, exclude password from User queries unless explicitly selected
    const isUserModel = this._Model.tableName === 'users';
    const fields = this._selectedFields || [];
    const includePassword = fields.includes('+password');
    const positive = fields.filter((field) => !field.startsWith('-') && !field.startsWith('+'));
    const negative = fields.filter((field) => field.startsWith('-')).map((field) => field.slice(1));
    if (positive.length) {
      opts.attributes = positive.map((field) => field === '_id' ? 'id' : field)
        .filter((field) => !isUserModel || field !== 'password' || includePassword);
      if (isUserModel && includePassword && !opts.attributes.includes('password')) opts.attributes.push('password');
    } else if (negative.length || (isUserModel && !includePassword)) {
      opts.attributes = { exclude: [...new Set([...negative, ...(isUserModel && !includePassword ? ['password'] : [])])] };
    }
    if (this._options.attributes) {
      opts.attributes = this._options.attributes;
      if (isUserModel) throw new Error('Custom attributes are not supported on user queries');
    }

    if (this._isMany) {
      const rows = await this._Model.findAll(opts);
      const plains = rows.map(r => toPlain(r));
      if (this._isLean) return plains;
      return plains.map(p => new ModelInstance(p, this._wrapper));
    } else {
      const row = await this._Model.findOne(opts);
      if (!row) return null;
      const plain = toPlain(row);
      if (this._isLean) return plain;
      return new ModelInstance(plain, this._wrapper);
    }
  }

  then(resolve, reject) {
    return this._exec().then(resolve, reject);
  }

  catch(reject) {
    return this._exec().catch(reject);
  }
}

// ─── Main ModelWrapper class ──────────────────────────────────────────────────
class ModelWrapper {
  constructor(SequelizeModel) {
    this._Model = SequelizeModel;
    // Expose tableName for debugging
    this.tableName = SequelizeModel.tableName;
  }

  _buildWhere(filter) {
    return translateFilter(filter || {});
  }

  // new Model({...}) usage — returns a ModelInstance with .save()
  _new(data) {
    return new ModelInstance({ ...data }, this, false);
  }

  /**
   * Model.find(filter) — returns a QueryBuilder
   */
  find(filter = {}) {
    return new QueryBuilder(this._Model, this._buildWhere(filter), { _isMany: true, _wrapper: this });
  }

  /**
   * Model.findOne(filter) — returns a QueryBuilder
   */
  findOne(filter = {}) {
    return new QueryBuilder(this._Model, this._buildWhere(filter), { _isMany: false, _wrapper: this });
  }

  /**
   * Model.findOneAndUpdate(filter, update, opts)
   */
  async findOneAndUpdate(filter, update, opts = {}) {
    const where = this._buildWhere(filter);
    return withModelTransaction(this._Model, async (transaction) => {
      const row = await this._Model.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
      if (!row) return null;

      const current = structuredClone(toPlain(row));
      // A guarded idempotent replay may return false to preserve the original outcome.
      if (opts.validate && await opts.validate(current) === false) return new ModelInstance(current, this);
      const changes = {};

      // Handle $set, $push, $addToSet, $inc
      if (update.$set) Object.assign(changes, update.$set);
      if (update.$push) {
        for (const [field, val] of Object.entries(update.$push)) {
          const existing = Array.isArray(current[field]) ? current[field] : [];
          const values = val && typeof val === 'object' && '$each' in val ? val.$each : [val];
          if (!Array.isArray(values)) throw new Error('$each must be an array');
          changes[field] = [...existing, ...values];
        }
      }
      if (update.$addToSet) {
        for (const [field, val] of Object.entries(update.$addToSet)) {
          const existing = Array.isArray(current[field]) ? current[field] : [];
          const nextValues = Array.isArray(val) ? val : [val];
          changes[field] = Array.from(new Set([...existing, ...nextValues]));
        }
      }
      if (update.$inc) {
        for (const [field, val] of Object.entries(update.$inc)) {
          changes[field] = (current[field] || 0) + val;
        }
      }
      if (update.$unset) {
        for (const field of Object.keys(update.$unset)) {
          changes[field] = null;
        }
      }
      // If no operators, treat update as $set
      if (!Object.keys(update).some((field) => field.startsWith('$'))) {
        const cleaned = { ...update };
        delete cleaned._id;
        delete cleaned.__v;
        Object.assign(changes, cleaned);
      }

      // Hash password if needed
      if (changes.id !== undefined && changes.id !== current.id) {
        const error = new Error('Record identity is immutable'); error.status = 400; throw error;
      }
      if (changes.password && !changes.password.startsWith('$2')) {
        changes.password = await bcrypt.hash(changes.password, 10);
      }

      await row.update(changes, { transaction });
      return new ModelInstance(opts.new === false ? current : toPlain(row), this);
    });
  }

  /**
   * Model.findOneAndDelete(filter)
   */
  async findOneAndDelete(filter) {
    const where = this._buildWhere(filter);
    const transaction = currentTransaction();
    const row = await this._Model.findOne({ where, transaction });
    if (!row) return null;
    const plain = toPlain(row);
    await row.destroy({ transaction });
    return plain;
  }

  /**
   * Model.updateOne(filter, update, opts)
   */
  async updateOne(filter, update, opts = {}) {
    const requestedId = update.$set?.id ?? update.id;
    if (requestedId !== undefined && requestedId !== filter.id) throw new Error('Record identity is immutable');
    const transaction = currentTransaction();
    if (update.$inc || update.$push || update.$addToSet) {
      const updated = await this.findOneAndUpdate(filter, update, opts);
      if (updated) return { modifiedCount: 1 };
      if (!opts.upsert) return { modifiedCount: 0 };
    }

    const where = this._buildWhere(filter);
    const row = await this._Model.findOne({ where, transaction });

    const changes = {};
    if (update.$set) Object.assign(changes, update.$set);
    if (!update.$set) {
      const cleaned = { ...update };
      delete cleaned._id;
      delete cleaned.__v;
      Object.assign(changes, cleaned);
    }
    delete changes.id;
    if (update.$addToSet) {
      const current = row ? toPlain(row) : {};
      for (const [field, val] of Object.entries(update.$addToSet)) {
        const existing = Array.isArray(current[field]) ? current[field] : [];
        const nextValues = Array.isArray(val) ? val : [val];
        changes[field] = Array.from(new Set([...existing, ...nextValues]));
      }
    }
    if (update.$inc) {
      const current = row ? toPlain(row) : {};
      for (const [field, val] of Object.entries(update.$inc)) {
        changes[field] = (current[field] || 0) + val;
      }
    }

    if (changes.password && !changes.password.startsWith('$2')) {
      changes.password = await bcrypt.hash(changes.password, 10);
    }

    if (row) {
      await row.update(changes, { transaction });
    } else if (opts.upsert) {
      const base = {};
      // Pull id from filter if available
      if (filter.id) base.id = filter.id;
      await this._Model.upsert({ ...base, ...changes }, { transaction });
    }
    return { modifiedCount: row ? 1 : 0 };
  }

  /**
   * Model.updateMany(filter, update)
   */
  async updateMany(filter, update) {
    if (update.id !== undefined || update.$set?.id !== undefined) throw new Error('Record identity is immutable');
    const transaction = currentTransaction();
    const where = this._buildWhere(filter);
    const rows = await this._Model.findAll({ where, transaction });

    const baseChanges = {};
    if (update.$set) Object.assign(baseChanges, update.$set);
    else {
      const cleaned = { ...update };
      delete cleaned._id;
      delete cleaned.__v;
      Object.assign(baseChanges, cleaned);
    }

    for (const row of rows) {
      const current = toPlain(row);
      const changes = { ...baseChanges };
      if (update.$addToSet) {
        for (const [field, val] of Object.entries(update.$addToSet)) {
          const existing = Array.isArray(current[field]) ? current[field] : [];
          const nextValues = Array.isArray(val) ? val : [val];
          changes[field] = Array.from(new Set([...existing, ...nextValues]));
        }
      }
      if (update.$inc) {
        for (const [field, val] of Object.entries(update.$inc)) {
          changes[field] = (current[field] || 0) + val;
        }
      }
      await row.update(changes, { transaction });
    }
    return { modifiedCount: rows.length };
  }

  /**
   * Model.deleteMany(filter)
   */
  async deleteMany(filter) {
    const where = this._buildWhere(filter);
    const count = await this._Model.destroy({ where, transaction: currentTransaction() });
    return { deletedCount: count };
  }

  /**
   * Model.countDocuments(filter)
   */
  async countDocuments(filter = {}) {
    const where = this._buildWhere(filter);
    return this._Model.count({ where, transaction: currentTransaction() });
  }

  /**
   * Model.insertMany(records)
   */
  async insertMany(records, opts = {}) {
    return this._Model.bulkCreate(records, { ...opts, ignoreDuplicates: true });
  }

  /**
   * Make ModelWrapper callable as a constructor: new User({...})
   */
  static makeConstructable(wrapper) {
    // Return a proxy that handles both `new Model({})` and `Model.find()` etc.
    const proxy = new Proxy(function ModelConstructor(data) {
      return wrapper._new(data);
    }, {
      get(target, prop) {
        if (prop in wrapper) {
          const val = wrapper[prop];
          return typeof val === 'function' && prop !== '_Model' ? val.bind(wrapper) : val;
        }
        return target[prop];
      },
      construct(target, args) {
        return wrapper._new(args[0]);
      },
    });
    return proxy;
  }
}

module.exports = { ModelWrapper };

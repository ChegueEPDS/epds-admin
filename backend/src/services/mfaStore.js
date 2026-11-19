const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { databaseEngine, query } = require('../postgres');

const schema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  revision: { type: String, required: true },
  state: { type: mongoose.Schema.Types.Mixed, required: true }
}, { versionKey: false, minimize: false });
const LocalMfa = mongoose.models.LocalMfa || mongoose.model('LocalMfa', schema);

async function read(userId) {
  const record = databaseEngine() === 'postgresql'
    ? (await query('SELECT revision, state FROM local_mfa WHERE user_id=$1', [String(userId)])).rows[0]
    : await LocalMfa.findById(userId).lean();
  return record || { revision: null, state: {} };
}

async function replace(userId, previous, state) {
  const revision = randomUUID();
  if (databaseEngine() === 'postgresql') {
    const result = previous
      ? await query('UPDATE local_mfa SET revision=$3,state=$4 WHERE user_id=$1 AND revision=$2',
        [String(userId), previous, revision, JSON.stringify(state)])
      : await query('INSERT INTO local_mfa (user_id,revision,state) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [String(userId), revision, JSON.stringify(state)]);
    return result.rowCount === 1 ? revision : null;
  }
  if (previous) {
    const result = await LocalMfa.updateOne({ _id: userId, revision: previous }, { revision, state });
    return result.modifiedCount === 1 ? revision : null;
  }
  try {
    await LocalMfa.create({ _id: userId, revision, state });
    return revision;
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
}

async function remove(userId, { client, session }) {
  if (client) return client.query('DELETE FROM local_mfa WHERE user_id=$1', [String(userId)]);
  return LocalMfa.deleteOne({ _id: userId }, { session });
}

module.exports = { read, replace, remove };

// A round has one vote per location. Retries never manufacture extra locations.
function bounded(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

async function confirmMeasurement({ localProbe, remoteProbes = [], recovering = false, delay = ms => new Promise(resolve => setTimeout(resolve, ms)), retryDelayMs = 1500 }) {
  const attempts = [];
  const required = recovering ? 2 : 1;
  async function location(name, probe) {
    let successes = 0;
    let failures = 0;
    let latest;
    for (let index = 0; index < 3; index += 1) {
      try {
        latest = await probe();
        if (!latest || typeof latest.ok !== 'boolean') throw new Error('Invalid probe result');
        attempts.push({ location: name, ok: latest.ok, checkedAt: latest.checkedAt, responseMs: latest.responseMs, errorType: latest.errorType });
        if (latest.ok) { successes += 1; failures = 0; } else { failures += 1; successes = 0; }
        if (successes >= required) return { name, vote: 'up', result: latest };
        if (failures >= 3) return { name, vote: 'down', result: latest };
      } catch {
        // A probe infrastructure failure is not evidence that the target is down.
        attempts.push({ location: name, unavailable: true });
        return { name, vote: 'unknown' };
      }
      if (index < 2) await delay(retryDelayMs);
    }
    return { name, vote: 'unknown', result: latest };
  }
  const votes = await Promise.all([location('local', localProbe), ...remoteProbes.map(probe => location(probe.name, probe.run))]);
  const quorum = votes.length > 1 ? Math.floor(votes.length / 2) + 1 : 1;
  const up = votes.filter(vote => vote.vote === 'up');
  const down = votes.filter(vote => vote.vote === 'down');
  const decision = up.length >= quorum ? 'up' : down.length >= quorum ? 'down' : 'unknown';
  const result = (decision === 'up' ? up : down)[0]?.result;
  return { decision, result, attempts, locations: votes.map(({ name, vote }) => ({ name, vote })), quorum, confirmedAt: new Date() };
}

function remoteProbeConfiguration(raw = process.env.DOMAIN_HEALTH_REMOTE_PROBES || '[]') {
  const configs = JSON.parse(raw);
  if (!Array.isArray(configs) || configs.length > 4) throw new Error('Remote probes must be an array with at most four locations');
  const names = new Set(['local']);
  return configs.map(item => {
    const url = new URL(item.url);
    if (url.protocol !== 'https:' || url.username || url.password || !item.token || !item.name || names.has(item.name)) throw new Error('Remote probes require unique names, HTTPS and a token');
    names.add(item.name);
    return { name: String(item.name), url: url.href, token: String(item.token) };
  });
}
module.exports = { bounded, confirmMeasurement, remoteProbeConfiguration };

const MAX_RECORDS_RETURNED = 10000;

let fitSdkPromise;
function getFitSdk() {
  fitSdkPromise ||= import('@garmin/fitsdk');
  return fitSdkPromise;
}

function asDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function secondsBetween(start, end) {
  return Math.max(0, (end.getTime() - start.getTime()) / 1000);
}

function formatDevice(device) {
  return [device.manufacturer, device.productName || device.garminProduct || device.product]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .join(' · ');
}

async function decodeFit(buffer) {
  const { Decoder, Stream, Profile } = await getFitSdk();
  const stream = Stream.fromByteArray([...buffer]);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new Error('A feltöltött fájl nem érvényes FIT fájl.');
  const ordered = [];
  const result = decoder.read({
    mesgListener: (mesgNum, message) => ordered.push({ mesgNum, ...message }),
    // Unknown/developer fields cannot always be emitted by the profile-based Encoder
    // and previously caused "Could not write Message" during preview/export.
    includeUnknownData: false
  });
  if (!ordered.length) throw new Error(result.errors?.[0]?.message || 'A FIT fájl nem tartalmaz feldolgozható adatot.');
  return { messages: result.messages, ordered, Profile };
}

function findPauses(events, records) {
  const timerEvents = events
    .filter((item) => item.event === 'timer' && asDate(item.timestamp))
    .sort((a, b) => asDate(a.timestamp) - asDate(b.timestamp));
  const pauses = [];
  let stoppedAt = null;
  for (const event of timerEvents) {
    const type = String(event.eventType || '').toLowerCase();
    if ((type.includes('stop') || type === 'pause') && !stoppedAt) stoppedAt = asDate(event.timestamp);
    if ((type.includes('start') || type === 'resume') && stoppedAt) {
      const end = asDate(event.timestamp);
      if (end > stoppedAt) pauses.push({ start: stoppedAt, end, source: 'timer' });
      stoppedAt = null;
    }
  }

  if (!pauses.length && records.length > 1) {
    const sorted = records.map((r) => asDate(r.timestamp)).filter(Boolean).sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      const gap = secondsBetween(sorted[index - 1], sorted[index]);
      if (gap >= 10) pauses.push({ start: sorted[index - 1], end: sorted[index], source: 'record-gap' });
    }
  }

  return pauses.map((pause, index) => ({
    id: `pause-${index + 1}`,
    start: pause.start.toISOString(),
    end: pause.end.toISOString(),
    duration: secondsBetween(pause.start, pause.end),
    source: pause.source
  }));
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function recordsInRange(records, start, end) {
  if (!start || !end) return records;
  return records.filter((record) => {
    const timestamp = asDate(record.timestamp);
    return timestamp && timestamp >= start && timestamp <= end;
  });
}

function activityMetrics(source = {}, records = []) {
  const altitudes = records
    .map((record) => Number(record.enhancedAltitude ?? record.altitude))
    .filter(Number.isFinite);
  let calculatedAscent = 0;
  let calculatedDescent = 0;
  for (let index = 1; index < altitudes.length; index += 1) {
    const difference = altitudes[index] - altitudes[index - 1];
    if (difference > 0) calculatedAscent += difference;
    if (difference < 0) calculatedDescent += Math.abs(difference);
  }
  const cadenceValues = records
    .map((record) => Number(record.cadence))
    .filter((value) => Number.isFinite(value) && value > 0);
  return {
    totalAscent: Number.isFinite(Number(source.totalAscent)) ? Number(source.totalAscent) : (altitudes.length > 1 ? calculatedAscent : null),
    totalDescent: Number.isFinite(Number(source.totalDescent)) ? Number(source.totalDescent) : (altitudes.length > 1 ? calculatedDescent : null),
    avgHeartRate: Number.isFinite(Number(source.avgHeartRate)) ? Number(source.avgHeartRate) : average(records.map((record) => record.heartRate)),
    avgPower: Number.isFinite(Number(source.avgPower)) ? Number(source.avgPower) : average(records.map((record) => record.power)),
    normalizedPower: Number.isFinite(Number(source.normalizedPower)) ? Number(source.normalizedPower) : null,
    // FIT avgCadence may include coasting. Product requirement explicitly excludes zero samples.
    avgCadence: average(cadenceValues),
    avgSpeed: Number.isFinite(Number(source.enhancedAvgSpeed ?? source.avgSpeed))
      ? Number(source.enhancedAvgSpeed ?? source.avgSpeed)
      : average(records.map((record) => record.enhancedSpeed ?? record.speed))
  };
}

function uniqueSensorDetails(devices) {
  const unique = new Map();
  for (const device of devices) {
    const serial = device.serialNumber;
    const fallbackKey = [
      device.manufacturer,
      device.productName || device.garminProduct || device.product,
      device.antDeviceType || device.sourceType || device.deviceType
    ].map((value) => String(value ?? '').trim().toLowerCase()).join('|');
    const key = serial !== undefined && serial !== null && serial !== ''
      ? `serial:${String(serial).trim().toLowerCase()}`
      : `device:${fallbackKey}`;
    const detail = {
      timestamp: asDate(device.timestamp)?.toISOString() || null,
      name: device.productName || device.garminProduct || device.product || null,
      manufacturer: device.manufacturer || null,
      serialNumber: device.serialNumber ?? null,
      deviceType: device.antDeviceType || device.sourceType || device.deviceType || null,
      batteryStatus: device.batteryStatus || null,
      batteryVoltage: device.batteryVoltage ?? null,
      softwareVersion: device.softwareVersion ?? null,
      hardwareVersion: device.hardwareVersion ?? null,
      sensorPosition: device.sensorPosition || null
    };
    const previous = unique.get(key);
    unique.set(key, previous
      ? Object.fromEntries(Object.keys(detail).map((field) => [field, detail[field] ?? previous[field] ?? null]))
      : detail);
  }
  return [...unique.values()].map((detail, index) => ({ index: index + 1, ...detail }));
}

function summarize(messages) {
  const records = messages.recordMesgs || [];
  const sessions = messages.sessionMesgs || [];
  const session = sessions[0] || {};
  const activity = (messages.activityMesgs || [])[0] || {};
  const devices = messages.deviceInfoMesgs || [];
  const events = messages.eventMesgs || [];
  const timestamps = records.map((r) => asDate(r.timestamp)).filter(Boolean).sort((a, b) => a - b);
  const start = asDate(session.startTime) || timestamps[0] || asDate(activity.timestamp);
  const end = timestamps.at(-1) || asDate(session.timestamp) || asDate(activity.timestamp);
  const gross = start && end ? secondsBetween(start, end) : Number(session.totalElapsedTime || 0);
  const net = Number(session.totalTimerTime ?? activity.totalTimerTime ?? gross);
  const temperatures = records.map((r) => Number(r.temperature)).filter(Number.isFinite);
  const sport = String(session.sport || activity.sport || '').toLowerCase();
  const pauses = findPauses(events, records);
  const laps = (messages.lapMesgs || []).map((lap, index) => {
    const lapStart = asDate(lap.startTime);
    const lapEnd = asDate(lap.timestamp);
    const lapRecords = recordsInRange(records, lapStart, lapEnd);
    return {
      id: `lap-${index + 1}`,
      label: `Kör ${index + 1}`,
      startTime: lapStart?.toISOString() || null,
      endTime: lapEnd?.toISOString() || null,
      netTime: Number(lap.totalTimerTime ?? 0),
      grossTime: Number(lap.totalElapsedTime ?? (lapStart && lapEnd ? secondsBetween(lapStart, lapEnd) : 0)),
      pauseTime: Math.max(0, Number(lap.totalElapsedTime || 0) - Number(lap.totalTimerTime || 0)),
      ...activityMetrics(lap, lapRecords)
    };
  });

  return {
    sport: sport.includes('cycl') ? 'Kerékpár' : sport.includes('run') ? 'Futás' : (session.sport || 'Ismeretlen'),
    startTime: start?.toISOString() || null,
    endTime: end?.toISOString() || null,
    netTime: net,
    grossTime: gross,
    pauseTime: pauses.reduce((sum, pause) => sum + pause.duration, 0) || Math.max(0, gross - net),
    minTemperature: temperatures.length ? Math.min(...temperatures) : session.minTemperature ?? null,
    maxTemperature: temperatures.length ? Math.max(...temperatures) : session.maxTemperature ?? null,
    devices: devices.map(formatDevice).filter(Boolean),
    sensors: [...new Set(devices.map((d) => d.sourceType || d.antDeviceType).filter(Boolean))],
    sensorDetails: uniqueSensorDetails(devices),
    pauses,
    recordCount: records.length,
    metrics: activityMetrics(session, records),
    laps
  };
}

function tableRecords(messages) {
  return (messages.recordMesgs || []).slice(0, MAX_RECORDS_RETURNED).map((record, index) => ({
    index: index + 1,
    timestamp: asDate(record.timestamp)?.toISOString() || null,
    distance: record.distance ?? null,
    speed: record.enhancedSpeed ?? record.speed ?? null,
    heartRate: record.heartRate ?? null,
    cadence: record.cadence ?? null,
    power: record.power ?? null,
    altitude: record.enhancedAltitude ?? record.altitude ?? null,
    temperature: record.temperature ?? null,
    positionLat: record.positionLat ?? null,
    positionLong: record.positionLong ?? null
  }));
}

async function analyzeFit(buffer) {
  const decoded = await decodeFit(buffer);
  return { summary: summarize(decoded.messages), records: tableRecords(decoded.messages) };
}

function shiftDateFields(message, deltaMs, threshold = null) {
  for (const [key, value] of Object.entries(message)) {
    if (!(value instanceof Date)) continue;
    if (!/(timestamp|startTime|timeCreated|localTimestamp)$/i.test(key)) continue;
    if (!threshold || value >= threshold) message[key] = new Date(value.getTime() + deltaMs);
  }
}

async function modifyFit(buffer, options = {}) {
  const decoded = await decodeFit(buffer);
  const before = summarize(decoded.messages);
  const selectedIds = new Set(Array.isArray(options.pauseIds) ? options.pauseIds : []);
  const selectedPauses = before.pauses.filter((pause) => selectedIds.has(pause.id));
  const speedFactor = 1 + (Number(options.speedPercent) || 0) / 100;
  const powerFactor = 1 + (Number(options.powerPercent) || 0) / 100;
  if (speedFactor <= 0 || powerFactor <= 0) throw new Error('A módosítás százaléka nem eredményezhet nulla vagy negatív értéket.');
  const removedPauseEvents = new Set(decoded.ordered.filter((message) => {
    if (message.event !== 'timer') return false;
    const timestamp = asDate(message.timestamp);
    return timestamp && selectedPauses.some((pause) => timestamp >= asDate(pause.start) && timestamp <= asDate(pause.end));
  }));

  for (const message of decoded.ordered) {
    for (const pause of selectedPauses) {
      const end = asDate(pause.end);
      shiftDateFields(message, -pause.duration * 1000, end);
    }
    if (options.startTime && before.startTime) {
      const requested = asDate(options.startTime);
      const original = asDate(before.startTime);
      if (!requested) throw new Error('Érvénytelen kezdési dátum vagy időpont.');
      shiftDateFields(message, requested.getTime() - original.getTime());
    }
    for (const field of ['speed', 'enhancedSpeed', 'avgSpeed', 'maxSpeed', 'enhancedAvgSpeed', 'enhancedMaxSpeed']) {
      if (Number.isFinite(message[field])) message[field] = Math.max(0, message[field] * speedFactor);
    }
    for (const field of ['power', 'avgPower', 'maxPower', 'normalizedPower']) {
      if (Number.isFinite(message[field])) message[field] = Math.max(0, Math.round(message[field] * powerFactor));
    }
    if (selectedPauses.length) {
      const removed = selectedPauses.reduce((sum, pause) => sum + pause.duration, 0);
      // Timer time already excludes pauses; only elapsed (wall-clock) durations shrink.
      for (const field of ['totalElapsedTime']) {
        if (Number.isFinite(message[field])) message[field] = Math.max(0, message[field] - removed);
      }
    }
  }

  const { Encoder } = await getFitSdk();
  const encoder = new Encoder();
  let writtenMessages = 0;
  for (const message of decoded.ordered) {
    if (removedPauseEvents.has(message)) continue;
    const { mesgNum, ...data } = message;
    try {
      encoder.onMesg(mesgNum, data);
      writtenMessages += 1;
    } catch (error) {
      // Some vendor-specific messages decode without a writable FIT profile
      // definition. They are ancillary; retain all standard activity messages.
      console.warn(`[fit] skipped non-writable message ${mesgNum}: ${error.message}`);
    }
  }
  if (!writtenMessages) throw new Error('A FIT fájl nem tartalmaz visszaírható szabványos adatokat.');
  return Buffer.from(encoder.close());
}

module.exports = { analyzeFit, modifyFit };

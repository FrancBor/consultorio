import { createHash } from 'node:crypto';

export const SYNTHETIC_SOURCE = 'semilla_sintetica_dashboard_v1';
export const SYNTHETIC_BATCH_KEY = 'dashboard-2026-04_2026-09-v1';

export const MONTH_QUOTAS = Object.freeze([
  { month: '2026-04', appointments: 305, attended: 231, averageWait: 27.1 },
  { month: '2026-05', appointments: 298, attended: 224, averageWait: 29.4 },
  { month: '2026-06', appointments: 312, attended: 248, averageWait: 24.8 },
  { month: '2026-07', appointments: 306, attended: 266, averageWait: 21.2 },
  { month: '2026-08', appointments: 315, attended: 279, averageWait: 19.6 },
  { month: '2026-09', appointments: 304, attended: 279, averageWait: 18.3 },
]);

const CARE_TYPES = Object.freeze([
  'medicina_general',
  'control_cronico',
  'control_salud',
  'enfermeria',
  'odontologia',
]);

const SEPTEMBER_EXAMPLES = Object.freeze([
  { day: 8, time: '08:30', careType: 'medicina_general', attended: true, wait: 14 },
  { day: 8, time: '09:00', careType: 'control_cronico', attended: false, wait: null },
  { day: 8, time: '09:30', careType: 'enfermeria', attended: true, wait: 22 },
  { day: 9, time: '10:00', careType: 'odontologia', attended: true, wait: 31 },
  { day: 9, time: '10:30', careType: 'control_salud', attended: true, wait: 9 },
  { day: 9, time: '11:00', careType: 'medicina_general', attended: false, wait: null },
]);

function offsetForMonth(month) {
  return month === '2026-09' ? '-03:00' : '-04:00';
}

function localTimestamp(month, day, time) {
  return `${month}-${String(day).padStart(2, '0')}T${time}:00${offsetForMonth(month)}`;
}

function addMinutes(timestamp, minutes) {
  return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString();
}

function generatedSlot(month, index) {
  const day = 10 + Math.floor(index / 18);
  const minutes = 8 * 60 + (index % 18) * 30;
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
  const minute = String(minutes % 60).padStart(2, '0');
  return localTimestamp(month, day, `${hour}:${minute}`);
}

function assignWaits(records, targetAverage) {
  const attended = records.filter((record) => record.attended);
  const targetTotal = Math.round(targetAverage * attended.length);
  const predefinedTotal = attended.reduce((total, record) => total + (record.wait ?? 0), 0);
  const pending = attended.filter((record) => record.wait === undefined);

  if (pending.length === 0) {
    if (predefinedTotal !== targetTotal) throw new Error('Synthetic wait quota is inconsistent.');
    return;
  }

  const remainingTotal = targetTotal - predefinedTotal;
  const baseWait = Math.floor(remainingTotal / pending.length);
  const remainder = remainingTotal - baseWait * pending.length;

  pending.forEach((record, index) => {
    record.wait = baseWait + (index < remainder ? 1 : 0);
  });
}

function canonicalRecord(record) {
  return {
    key: record.key,
    careType: record.careType,
    requestStatus: 'cerrada',
    requestAt: record.requestAt,
    closedAt: record.appointmentAt,
    appointmentStatus: record.attended ? 'atendida' : 'inasistencia',
    appointmentAt: record.appointmentAt,
    wait: record.attended ? record.wait : null,
  };
}

export function generateSyntheticDataset() {
  const records = [];
  let globalIndex = 0;

  for (const quota of MONTH_QUOTAS) {
    const monthRecords = [];
    const examples = quota.month === '2026-09' ? SEPTEMBER_EXAMPLES : [];

    for (const example of examples) {
      monthRecords.push({
        appointmentAt: localTimestamp(quota.month, example.day, example.time),
        careType: example.careType,
        attended: example.attended,
        wait: example.wait,
      });
    }

    const attendedExamples = examples.filter((example) => example.attended).length;
    const generatedCount = quota.appointments - examples.length;
    const generatedAttended = quota.attended - attendedExamples;

    for (let index = 0; index < generatedCount; index += 1) {
      monthRecords.push({
        appointmentAt: generatedSlot(quota.month, index),
        careType: CARE_TYPES[(globalIndex + index) % CARE_TYPES.length],
        attended: index < generatedAttended,
        wait: index < generatedAttended ? undefined : null,
      });
    }

    assignWaits(monthRecords, quota.averageWait);

    for (const record of monthRecords) {
      globalIndex += 1;
      const key = String(globalIndex).padStart(4, '0');
      records.push(
        canonicalRecord({
          ...record,
          key,
          requestAt: `${record.appointmentAt.slice(0, 10)}T07:00:00${offsetForMonth(quota.month)}`,
        }),
      );
    }
  }

  const serialized = JSON.stringify(records);

  return Object.freeze({
    source: SYNTHETIC_SOURCE,
    batchKey: SYNTHETIC_BATCH_KEY,
    contentHash: createHash('sha256').update(serialized).digest('hex'),
    records: Object.freeze(records.map((record) => Object.freeze(record))),
  });
}

function epochSeconds(timestamp) {
  return Math.floor(Date.parse(timestamp) / 1_000);
}

export function expectedReconciliationRows(dataset) {
  return dataset.records.map((record) => ({
    requestKey: record.key,
    requestCareType: record.careType,
    requestStatus: record.requestStatus,
    requestUnitId: null,
    requestEpoch: epochSeconds(record.requestAt),
    closedEpoch: epochSeconds(record.closedAt),
    appointmentKey: record.key,
    appointmentCareType: record.careType,
    appointmentStatus: record.appointmentStatus,
    appointmentUnitId: null,
    appointmentLinked: true,
    appointmentEpoch: epochSeconds(record.appointmentAt),
    attentionPresent: record.appointmentStatus === 'atendida',
    attentionKey: record.appointmentStatus === 'atendida' ? record.key : null,
    attentionLinked: record.appointmentStatus === 'atendida',
    arrivalEpoch: null,
    attentionStartEpoch:
      record.appointmentStatus === 'atendida' ? epochSeconds(record.appointmentAt) : null,
    attentionEndEpoch:
      record.appointmentStatus === 'atendida' ? epochSeconds(attentionEndAt(record)) : null,
    wait: record.wait,
  }));
}

export function reconcileSyntheticRows(dataset, actualRows) {
  const expectedRows = expectedReconciliationRows(dataset);

  if (actualRows.length !== expectedRows.length) return false;

  return expectedRows.every((expected, index) => {
    const actual = actualRows[index];
    return (
      actual.requestKey === expected.requestKey &&
      actual.requestCareType === expected.requestCareType &&
      actual.requestStatus === expected.requestStatus &&
      actual.requestUnitId === expected.requestUnitId &&
      Number(actual.requestEpoch) === expected.requestEpoch &&
      Number(actual.closedEpoch) === expected.closedEpoch &&
      actual.appointmentKey === expected.appointmentKey &&
      actual.appointmentCareType === expected.appointmentCareType &&
      actual.appointmentStatus === expected.appointmentStatus &&
      actual.appointmentUnitId === expected.appointmentUnitId &&
      actual.appointmentLinked === expected.appointmentLinked &&
      Number(actual.appointmentEpoch) === expected.appointmentEpoch &&
      actual.attentionPresent === expected.attentionPresent &&
      actual.attentionKey === expected.attentionKey &&
      actual.attentionLinked === expected.attentionLinked &&
      (actual.arrivalEpoch === null ? null : Number(actual.arrivalEpoch)) ===
        expected.arrivalEpoch &&
      (actual.attentionStartEpoch === null ? null : Number(actual.attentionStartEpoch)) ===
        expected.attentionStartEpoch &&
      (actual.attentionEndEpoch === null ? null : Number(actual.attentionEndEpoch)) ===
        expected.attentionEndEpoch &&
      (actual.wait === null ? null : Number(actual.wait)) === expected.wait
    );
  });
}

export function syntheticDatasetSummary(dataset) {
  const attendedRecords = dataset.records.filter(
    (record) => record.appointmentStatus === 'atendida',
  );

  return {
    requests: dataset.records.length,
    appointments: dataset.records.length,
    attended: attendedRecords.length,
    absences: dataset.records.length - attendedRecords.length,
  };
}

export function attentionEndAt(record) {
  return addMinutes(record.appointmentAt, 30);
}

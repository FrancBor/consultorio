import { describe, expect, it, vi } from 'vitest';
import { runSyntheticSeed } from '../scripts/seed-synthetic-data.js';
import {
  generateSyntheticDataset,
  MONTH_QUOTAS,
  reconcileSyntheticRows,
  syntheticDatasetSummary,
} from '../src/modules/analytics/synthetic-data.js';

function actualRowsFrom(dataset) {
  return dataset.records.map((record) => ({
    requestKey: record.key,
    requestCareType: record.careType,
    requestStatus: record.requestStatus,
    requestUnitId: null,
    requestEpoch: Math.floor(Date.parse(record.requestAt) / 1_000),
    closedEpoch: Math.floor(Date.parse(record.closedAt) / 1_000),
    appointmentKey: record.key,
    appointmentCareType: record.careType,
    appointmentStatus: record.appointmentStatus,
    appointmentUnitId: null,
    appointmentLinked: true,
    appointmentEpoch: Math.floor(Date.parse(record.appointmentAt) / 1_000),
    attentionPresent: record.appointmentStatus === 'atendida',
    attentionKey: record.appointmentStatus === 'atendida' ? record.key : null,
    attentionLinked: record.appointmentStatus === 'atendida',
    arrivalEpoch: null,
    attentionStartEpoch:
      record.appointmentStatus === 'atendida'
        ? Math.floor(Date.parse(record.appointmentAt) / 1_000)
        : null,
    attentionEndEpoch:
      record.appointmentStatus === 'atendida'
        ? Math.floor((Date.parse(record.appointmentAt) + 30 * 60_000) / 1_000)
        : null,
    wait: record.wait,
  }));
}

describe('deterministic synthetic dataset', () => {
  it('matches every monthly quota and global count', () => {
    const dataset = generateSyntheticDataset();

    expect(syntheticDatasetSummary(dataset)).toEqual({
      requests: 1840,
      appointments: 1840,
      attended: 1527,
      absences: 313,
    });

    for (const quota of MONTH_QUOTAS) {
      const month = dataset.records.filter((record) =>
        record.appointmentAt.startsWith(quota.month),
      );
      const attended = month.filter((record) => record.appointmentStatus === 'atendida');
      expect(month).toHaveLength(quota.appointments);
      expect(attended).toHaveLength(quota.attended);
      expect(Number((attended.reduce((sum, record) => sum + record.wait, 0) / attended.length).toFixed(1))).toBe(
        quota.averageWait,
      );
    }
  });

  it('is byte-for-byte deterministic and distributes all five care types', () => {
    const first = generateSyntheticDataset();
    const second = generateSyntheticDataset();

    expect(second.contentHash).toBe(first.contentHash);
    expect(second.records).toEqual(first.records);
    expect(new Set(first.records.map((record) => record.careType))).toEqual(
      new Set([
        'medicina_general',
        'control_cronico',
        'control_salud',
        'enfermeria',
        'odontologia',
      ]),
    );
  });

  it('contains the six historical detail examples without personal or clinical data', () => {
    const dataset = generateSyntheticDataset();
    const examples = dataset.records.filter((record) =>
      ['2026-09-08', '2026-09-09'].includes(record.appointmentAt.slice(0, 10)),
    );
    const serialized = JSON.stringify(dataset.records).toLowerCase();

    expect(examples).toHaveLength(6);
    expect(examples.map((record) => [
      record.appointmentAt.slice(0, 16),
      record.careType,
      record.appointmentStatus,
      record.wait,
    ])).toEqual([
      ['2026-09-08T08:30', 'medicina_general', 'atendida', 14],
      ['2026-09-08T09:00', 'control_cronico', 'inasistencia', null],
      ['2026-09-08T09:30', 'enfermeria', 'atendida', 22],
      ['2026-09-09T10:00', 'odontologia', 'atendida', 31],
      ['2026-09-09T10:30', 'control_salud', 'atendida', 9],
      ['2026-09-09T11:00', 'medicina_general', 'inasistencia', null],
    ]);
    for (const forbidden of ['rut', 'paciente', 'diagnostico', 'correo', 'telefono', 'documento']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('reconciles exact rows and rejects partial data', () => {
    const dataset = generateSyntheticDataset();
    const actual = actualRowsFrom(dataset);

    expect(reconcileSyntheticRows(dataset, actual)).toBe(true);
    expect(reconcileSyntheticRows(dataset, actual.slice(1))).toBe(false);
  });

  it.each([
    ['requestKey', 'changed-request-key'],
    ['requestCareType', 'odontologia'],
    ['requestStatus', 'cancelada'],
    ['requestUnitId', '1'],
    ['requestEpoch', 1],
    ['closedEpoch', 1],
    ['appointmentKey', 'changed-appointment-key'],
    ['appointmentCareType', 'odontologia'],
    ['appointmentStatus', 'confirmada'],
    ['appointmentUnitId', '1'],
    ['appointmentLinked', false],
    ['appointmentEpoch', 1],
    ['attentionPresent', false],
    ['attentionKey', 'changed-attention-key'],
    ['attentionLinked', false],
    ['arrivalEpoch', 1],
    ['attentionStartEpoch', 1],
    ['attentionEndEpoch', 1],
    ['wait', 999],
  ])('rejects corruption of %s', (field, changedValue) => {
    const dataset = generateSyntheticDataset();
    const actual = actualRowsFrom(dataset);
    actual[0] = { ...actual[0], [field]: changedValue };

    expect(reconcileSyntheticRows(dataset, actual)).toBe(false);
  });

  it('rejects an unexpected attention on an absent appointment', () => {
    const dataset = generateSyntheticDataset();
    const actual = actualRowsFrom(dataset);
    const absentIndex = actual.findIndex((row) => row.appointmentStatus === 'inasistencia');
    actual[absentIndex] = {
      ...actual[absentIndex],
      attentionPresent: true,
      attentionKey: 'unexpected-attention',
      attentionLinked: true,
      attentionStartEpoch: actual[absentIndex].appointmentEpoch,
      attentionEndEpoch: actual[absentIndex].appointmentEpoch + 1_800,
      wait: 10,
    };

    expect(reconcileSyntheticRows(dataset, actual)).toBe(false);
  });

  it('rejects production before opening a database connection', async () => {
    const pool = { connect: vi.fn() };

    await expect(
      runSyntheticSeed({ pool, environment: { NODE_ENV: 'production' } }),
    ).rejects.toThrow('development o test');
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';

export const IMPORT_SOURCE = 'carga_manual_v1';
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 50_000;
export const IMPORT_COLUMNS = [
  'clave_origen',
  'tipo_atencion_codigo',
  'estado_solicitud_codigo',
  'unidad_codigo',
  'solicitada_en',
  'cerrada_en',
  'estado_cita_codigo',
  'inicio_agendado_en',
  'llegada_en',
  'inicio_atencion_en',
  'fin_atencion_en',
  'duracion_espera_reportada_minutos',
];

const CODE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/i;
const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_ERRORS = 100;

class ValidationErrors extends Array {
  constructor() {
    super();
    this.truncated = false;
  }

  push(...items) {
    for (const item of items) {
      if (this.length < MAX_ERRORS) super.push(item);
      else this.truncated = true;
    }
    return this.length;
  }
}

export class ImportFileError extends Error {
  constructor(code, message, { errors = [], truncated = false } = {}) {
    super(message);
    this.name = 'ImportFileError';
    this.code = code;
    this.errors = errors;
    this.truncated = truncated;
  }
}

function validationError(code, record, field, message) {
  return { codigo: code, registro: record, campo: field, mensaje: message };
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ImportFileError('invalid_encoding', 'El archivo debe usar codificación UTF-8 válida.');
  }
}

function parseDocument(text, format) {
  if (format === 'json') {
    let value;
    try {
      value = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new ImportFileError('invalid_format', 'El archivo JSON no tiene una sintaxis válida.');
    }
    if (!Array.isArray(value)) {
      throw new ImportFileError('invalid_format', 'El documento JSON debe ser un arreglo de registros.');
    }
    return value;
  }

  let rows;
  try {
    rows = parseCsv(text, {
      bom: true,
      columns: false,
      max_record_size: 16_384,
      relax_column_count: false,
      skip_empty_lines: false,
    });
  } catch (error) {
    const record = Number.isInteger(error?.records) ? error.records + 1 : null;
    throw new ImportFileError('invalid_format', 'El archivo CSV no tiene una sintaxis válida.', {
      errors: [validationError('formato_invalido', record, null, 'Revise la estructura CSV.')],
    });
  }

  if (rows.length === 0) {
    throw new ImportFileError('empty_file', 'El archivo no contiene encabezado ni registros.');
  }
  const header = rows[0];
  if (
    header.length !== IMPORT_COLUMNS.length ||
    header.some((value, index) => value !== IMPORT_COLUMNS[index])
  ) {
    throw new ImportFileError(
      'invalid_columns',
      'El encabezado CSV no coincide exactamente con el contrato de importación.',
    );
  }

  return rows.slice(1).map((values) =>
    Object.fromEntries(IMPORT_COLUMNS.map((column, index) => [column, values[index]])),
  );
}

function normalizeString(value, { optional, maximum, pattern }, record, field, errors) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    if (!optional) {
      errors.push(validationError('campo_requerido', record, field, 'El campo es obligatorio.'));
    }
    return null;
  }
  if (typeof value !== 'string') {
    errors.push(validationError('valor_invalido', record, field, 'Debe ser una cadena de texto.'));
    return null;
  }
  const normalized = value.trim();
  if (normalized.length > maximum || (pattern && !pattern.test(normalized))) {
    errors.push(validationError('valor_invalido', record, field, 'El valor no cumple el formato permitido.'));
    return null;
  }
  return normalized;
}

function normalizeTimestamp(value, optional, record, field, errors) {
  const normalized = normalizeString(
    value,
    { optional, maximum: 40, pattern: OFFSET_TIMESTAMP_PATTERN },
    record,
    field,
    errors,
  );
  if (normalized === null) return null;
  const match = OFFSET_TIMESTAMP_PATTERN.exec(normalized);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  const offsetHour = match?.[7] === 'Z' ? 0 : Number(match?.[9]);
  const offsetMinute = match?.[7] === 'Z' ? 0 : Number(match?.[10]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const epoch = Date.parse(normalized);
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (daysInMonth[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0) ||
    !Number.isFinite(epoch)
  ) {
    errors.push(
      validationError('valor_invalido', record, field, 'Debe ser un timestamp ISO 8601 con offset.'),
    );
    return null;
  }
  return new Date(epoch).toISOString();
}

function normalizeWait(value, record, errors) {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d*)$/.test(text.trim())) {
    errors.push(
      validationError(
        'valor_invalido',
        record,
        'duracion_espera_reportada_minutos',
        'Debe ser un entero entre 0 y 1440.',
      ),
    );
    return null;
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed > 1_440) {
    errors.push(
      validationError(
        'valor_invalido',
        record,
        'duracion_espera_reportada_minutos',
        'Debe ser un entero entre 0 y 1440.',
      ),
    );
    return null;
  }
  return parsed;
}

function normalizeRecord(input, record, errors) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push(validationError('valor_invalido', record, null, 'El registro debe ser un objeto.'));
    return null;
  }

  const unknown = Object.keys(input).filter((field) => !IMPORT_COLUMNS.includes(field));
  for (const _field of unknown) {
    errors.push(
      validationError(
        'campo_desconocido',
        record,
        null,
        'El registro contiene un campo que no pertenece al contrato.',
      ),
    );
  }

  const output = {
    record_number: record,
    clave_origen: normalizeString(
      input.clave_origen,
      { optional: false, maximum: 200, pattern: KEY_PATTERN },
      record,
      'clave_origen',
      errors,
    ),
    tipo_atencion_codigo: normalizeString(
      input.tipo_atencion_codigo,
      { optional: false, maximum: 50, pattern: CODE_PATTERN },
      record,
      'tipo_atencion_codigo',
      errors,
    )?.toLowerCase() ?? null,
    estado_solicitud_codigo: normalizeString(
      input.estado_solicitud_codigo,
      { optional: false, maximum: 50, pattern: CODE_PATTERN },
      record,
      'estado_solicitud_codigo',
      errors,
    )?.toLowerCase() ?? null,
    unidad_codigo: normalizeString(
      input.unidad_codigo,
      { optional: true, maximum: 50, pattern: CODE_PATTERN },
      record,
      'unidad_codigo',
      errors,
    )?.toLowerCase() ?? null,
    solicitada_en: normalizeTimestamp(input.solicitada_en, false, record, 'solicitada_en', errors),
    cerrada_en: normalizeTimestamp(input.cerrada_en, true, record, 'cerrada_en', errors),
    estado_cita_codigo: normalizeString(
      input.estado_cita_codigo,
      { optional: false, maximum: 50, pattern: CODE_PATTERN },
      record,
      'estado_cita_codigo',
      errors,
    )?.toLowerCase() ?? null,
    inicio_agendado_en: normalizeTimestamp(
      input.inicio_agendado_en,
      false,
      record,
      'inicio_agendado_en',
      errors,
    ),
    llegada_en: normalizeTimestamp(input.llegada_en, true, record, 'llegada_en', errors),
    inicio_atencion_en: normalizeTimestamp(
      input.inicio_atencion_en,
      true,
      record,
      'inicio_atencion_en',
      errors,
    ),
    fin_atencion_en: normalizeTimestamp(
      input.fin_atencion_en,
      true,
      record,
      'fin_atencion_en',
      errors,
    ),
    duracion_espera_reportada_minutos: normalizeWait(
      input.duracion_espera_reportada_minutos,
      record,
      errors,
    ),
  };

  const terminalRequest = ['cerrada', 'cancelada'].includes(output.estado_solicitud_codigo);
  if (output.estado_solicitud_codigo && terminalRequest !== Boolean(output.cerrada_en)) {
    errors.push(
      validationError(
        'estado_incoherente',
        record,
        'cerrada_en',
        terminalRequest
          ? 'El estado de la solicitud requiere fecha de cierre.'
          : 'El estado de la solicitud no admite fecha de cierre.',
      ),
    );
  }
  if (output.solicitada_en && output.cerrada_en && output.cerrada_en < output.solicitada_en) {
    errors.push(
      validationError('estado_incoherente', record, 'cerrada_en', 'No puede preceder a solicitada_en.'),
    );
  }

  const attended = output.estado_cita_codigo === 'atendida';
  const hasAttentionData = [
    output.llegada_en,
    output.inicio_atencion_en,
    output.fin_atencion_en,
    output.duracion_espera_reportada_minutos,
  ].some((value) => value !== null);
  if (attended && !output.inicio_atencion_en) {
    errors.push(
      validationError(
        'estado_incoherente',
        record,
        'inicio_atencion_en',
        'Una cita atendida requiere inicio de atención.',
      ),
    );
  }
  if (!attended && hasAttentionData) {
    errors.push(
      validationError(
        'estado_incoherente',
        record,
        'estado_cita_codigo',
        'Solo una cita atendida puede contener datos de atención.',
      ),
    );
  }
  if (output.llegada_en && output.duracion_espera_reportada_minutos !== null) {
    errors.push(
      validationError(
        'estado_incoherente',
        record,
        'duracion_espera_reportada_minutos',
        'La espera reportada solo se admite cuando no existe llegada_en.',
      ),
    );
  }
  if (
    output.llegada_en &&
    output.inicio_atencion_en &&
    output.inicio_atencion_en < output.llegada_en
  ) {
    errors.push(
      validationError(
        'estado_incoherente',
        record,
        'inicio_atencion_en',
        'No puede preceder a llegada_en.',
      ),
    );
  }
  if (
    output.inicio_atencion_en &&
    output.fin_atencion_en &&
    output.fin_atencion_en < output.inicio_atencion_en
  ) {
    errors.push(
      validationError(
        'estado_incoherente',
        record,
        'fin_atencion_en',
        'No puede preceder a inicio_atencion_en.',
      ),
    );
  }

  return output;
}

export function detectImportFormat(filename, mimetype) {
  const extension = extname(filename).toLowerCase();
  const normalizedMime = String(mimetype).toLowerCase().split(';', 1)[0].trim();
  const types = {
    csv: new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel']),
    json: new Set(['application/json', 'text/json']),
  };
  const format = extension === '.csv' ? 'csv' : extension === '.json' ? 'json' : null;
  return format && types[format].has(normalizedMime) ? format : null;
}

export function parseImportFile({ buffer, originalname, mimetype }) {
  const format = detectImportFormat(originalname, mimetype);
  if (!format) {
    throw new ImportFileError('unsupported_file', 'Seleccione un archivo CSV o JSON válido.');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImportFileError('empty_file', 'El archivo está vacío.');
  }
  if (buffer.length > MAX_IMPORT_BYTES) {
    throw new ImportFileError('file_too_large', 'El archivo supera el máximo de 5 MiB.');
  }

  const rawRecords = parseDocument(decodeUtf8(buffer), format);
  if (rawRecords.length === 0) {
    throw new ImportFileError('empty_file', 'El archivo no contiene registros.');
  }
  if (rawRecords.length > MAX_IMPORT_ROWS) {
    throw new ImportFileError('too_many_rows', 'El archivo supera el máximo de 50.000 registros.');
  }

  const allErrors = new ValidationErrors();
  const records = rawRecords.map((record, index) => normalizeRecord(record, index + 1, allErrors));
  const seen = new Map();
  for (const record of records) {
    if (!record?.clave_origen) continue;
    if (seen.has(record.clave_origen)) {
      allErrors.push(
        validationError(
          'clave_duplicada',
          record.record_number,
          'clave_origen',
          `La clave ya fue declarada en el registro ${seen.get(record.clave_origen)}.`,
        ),
      );
    } else {
      seen.set(record.clave_origen, record.record_number);
    }
  }

  if (allErrors.length > 0) {
    throw new ImportFileError('validation_error', 'El archivo contiene datos no válidos.', {
      errors: [...allErrors],
      truncated: allErrors.truncated,
    });
  }

  return {
    format,
    hash: createHash('sha256').update(buffer).digest('hex'),
    records,
  };
}

import { describe, expect, it } from 'vitest';
import {
  CANCELED_UPLOAD_NOTICE,
  MAX_IMPORT_FILE_BYTES,
  canHandleUploadCallback,
  confirmImportUpload,
  finishUpload,
  importConfirmationMessage,
  tryBeginUpload,
  validateImportFileSelection,
} from '../../src/components/admin/data-import-state.js';

function file(name = 'datos.json', size = 1024) {
  return { name, size };
}

describe('data import UI state', () => {
  it('accepts exactly one bounded CSV/JSON file', () => {
    expect(validateImportFileSelection([file()])).toEqual({ file: file(), error: null });
    expect(validateImportFileSelection([]).error).toMatch(/exactamente un archivo/i);
    expect(validateImportFileSelection([file(), file('otro.csv')]).error).toMatch(
      /exactamente un archivo/i,
    );
    expect(validateImportFileSelection([file('datos.txt')]).error).toMatch(/extensión/i);
    expect(
      validateImportFileSelection([file('datos.csv', MAX_IMPORT_FILE_BYTES + 1)]).error,
    ).toMatch(/5 MiB/i);
  });

  it('creates an explicit confirmation with name, size, and transactional upsert warning', () => {
    const message = importConfirmationMessage(file('carga.json', 2 * 1024 * 1024));
    expect(message).toContain('carga.json');
    expect(message).toContain('2.00 MiB');
    expect(message).toMatch(/inserciones o actualizaciones/i);
    expect(message).toMatch(/una sola transacción/i);
    let prompt;
    expect(
      confirmImportUpload(file('carga.json', 2 * 1024 * 1024), (value) => {
        prompt = value;
        return false;
      }),
    ).toBe(false);
    expect(prompt).toBe(message);
  });

  it('uses a synchronous token mutex and rejects stale or unmounted callbacks', () => {
    const uploadRef = { current: null };
    const mountedRef = { current: true };
    const first = tryBeginUpload(uploadRef, mountedRef, file());
    expect(first).not.toBeNull();
    expect(tryBeginUpload(uploadRef, mountedRef, file())).toBeNull();
    expect(canHandleUploadCallback(uploadRef, mountedRef, first)).toBe(true);
    expect(finishUpload(uploadRef, Symbol('stale'))).toBe(false);
    mountedRef.current = false;
    expect(canHandleUploadCallback(uploadRef, mountedRef, first)).toBe(false);
    expect(finishUpload(uploadRef, first)).toBe(true);
    expect(tryBeginUpload(uploadRef, mountedRef, file())).toBeNull();
  });

  it('describes cancellation as ending browser wait without promising server rollback', () => {
    expect(CANCELED_UPLOAD_NOTICE).toMatch(/servidor puede haber completado/i);
    expect(CANCELED_UPLOAD_NOTICE).toMatch(/historial/i);
    expect(CANCELED_UPLOAD_NOTICE).not.toMatch(/revert|rollback/i);
  });
});

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024

export function formatImportFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'tamaño desconocido'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

export function validateImportFileSelection(files) {
  const selected = Array.from(files ?? [])
  if (selected.length !== 1) {
    return { file: null, error: 'Seleccione exactamente un archivo CSV o JSON.' }
  }
  const [file] = selected
  if (!/\.(?:csv|json)$/i.test(file.name)) {
    return { file: null, error: 'El archivo debe tener extensión .csv o .json.' }
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { file: null, error: 'El archivo supera el máximo de 5 MiB.' }
  }
  return { file, error: null }
}

export function importConfirmationMessage(file) {
  return [
    `Archivo: ${file.name}`,
    `Tamaño: ${formatImportFileSize(file.size)}`,
    '',
    'La importación validará el archivo completo y aplicará inserciones o actualizaciones en una sola transacción.',
    '¿Desea continuar?',
  ].join('\n')
}

export function confirmImportUpload(file, confirm) {
  return confirm(importConfirmationMessage(file)) === true
}

export function tryBeginUpload(uploadInFlightRef, mountedRef, file) {
  if (!mountedRef.current || uploadInFlightRef.current !== null || !file) return null
  const token = Symbol('upload')
  uploadInFlightRef.current = token
  return token
}

export function canHandleUploadCallback(uploadInFlightRef, mountedRef, token) {
  return mountedRef.current && uploadInFlightRef.current === token
}

export function finishUpload(uploadInFlightRef, token) {
  if (uploadInFlightRef.current !== token) return false
  uploadInFlightRef.current = null
  return true
}

export const CANCELED_UPLOAD_NOTICE =
  'Se canceló la espera en este navegador. El servidor puede haber completado la importación; revise el historial y use “Actualizar historial” para confirmar el resultado.'

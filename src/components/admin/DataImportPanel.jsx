import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getImport,
  isImportsAccessError,
  isImportsRequestCanceled,
  listImports,
  uploadImport,
} from '../../api/imports.js'
import {
  CANCELED_UPLOAD_NOTICE,
  canHandleUploadCallback,
  confirmImportUpload,
  finishUpload,
  formatImportFileSize,
  tryBeginUpload,
  validateImportFileSelection,
} from './data-import-state.js'

const PAGE_SIZE = 10

function formatDate(value) {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function ImportErrors({ details }) {
  const errors = details?.errores
  if (!Array.isArray(errors) || errors.length === 0) return null
  return (
    <div className="mt-3 rounded-lg border border-critical-100 bg-white p-3">
      <h3 className="text-sm font-semibold text-critical-600">Errores detectados</h3>
      <ul className="mt-2 max-h-56 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-slate-700">
        {errors.map((error, index) => (
          <li key={`${error.registro}-${error.campo}-${index}`}>
            {error.registro ? `Registro ${error.registro}: ` : ''}
            {error.campo ? `${error.campo} — ` : ''}
            {error.mensaje}
          </li>
        ))}
      </ul>
      {details.errores_truncados && (
        <p className="mt-2 text-sm font-medium text-critical-600">
          Se muestran los primeros 100 errores. Corrija el archivo y vuelva a validarlo.
        </p>
      )}
    </div>
  )
}

export default function DataImportPanel({ onAccessError }) {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [history, setHistory] = useState([])
  const [meta, setMeta] = useState(null)
  const [page, setPage] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [detail, setDetail] = useState(null)
  const mountedRef = useRef(false)
  const historyRequestRef = useRef({ sequence: 0, controller: null })
  const uploadControllerRef = useRef(null)
  const uploadInFlightRef = useRef(null)
  const dragDepthRef = useRef(0)
  const detailRequestRef = useRef({ sequence: 0, controller: null })
  const detailTriggerRef = useRef(null)
  const detailPanelRef = useRef(null)
  const feedbackRef = useRef(null)
  const fileInputRef = useRef(null)

  const loadHistory = useCallback(async (requestedPage) => {
    historyRequestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = historyRequestRef.current.sequence + 1
    historyRequestRef.current = { sequence, controller }
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const result = await listImports(
        { page: requestedPage, limit: PAGE_SIZE },
        { signal: controller.signal },
      )
      if (!mountedRef.current || historyRequestRef.current.sequence !== sequence) return
      if (result.meta.totalPages > 0 && requestedPage > result.meta.totalPages) {
        setPage(result.meta.totalPages)
        void loadHistory(result.meta.totalPages)
        return
      }
      setHistory(result.imports)
      setMeta(result.meta)
    } catch (error) {
      if (
        isImportsRequestCanceled(error) ||
        !mountedRef.current ||
        historyRequestRef.current.sequence !== sequence
      ) return
      setHistoryError(error.message || 'No fue posible cargar el historial.')
      if (isImportsAccessError(error)) onAccessError?.(error)
    } finally {
      if (mountedRef.current && historyRequestRef.current.sequence === sequence) {
        setHistoryLoading(false)
      }
    }
  }, [onAccessError])

  useEffect(() => {
    mountedRef.current = true
    void loadHistory(1)
    return () => {
      mountedRef.current = false
      historyRequestRef.current.controller?.abort()
      uploadControllerRef.current?.abort()
      detailRequestRef.current.controller?.abort()
    }
  }, [loadHistory])

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus()
  }, [feedback])

  useEffect(() => {
    if (detail) detailPanelRef.current?.focus()
  }, [detail])

  function applyFileSelection(files) {
    if (!mountedRef.current || uploadInFlightRef.current !== null) return false
    const selection = validateImportFileSelection(files)
    setFile(selection.file)
    setFeedback(
      selection.error ? { type: 'error', message: selection.error } : null,
    )
    setProgress(0)
    if (!selection.file && fileInputRef.current) fileInputRef.current.value = ''
    return Boolean(selection.file)
  }

  function selectFile(event) {
    if (uploadInFlightRef.current !== null) return
    applyFileSelection(event.target.files)
  }

  function dragEnter(event) {
    event.preventDefault()
    event.stopPropagation()
    if (uploadInFlightRef.current !== null) return
    dragDepthRef.current += 1
    setDragActive(true)
  }

  function dragOver(event) {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = uploadInFlightRef.current === null ? 'copy' : 'none'
  }

  function dragLeave(event) {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragActive(false)
  }

  function dropFile(event) {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setDragActive(false)
    if (uploadInFlightRef.current !== null) return
    applyFileSelection(event.dataTransfer.files)
  }

  async function submit(event) {
    event.preventDefault()
    if (!file || uploadInFlightRef.current !== null) return
    if (!confirmImportUpload(file, window.confirm)) return
    const uploadToken = tryBeginUpload(uploadInFlightRef, mountedRef, file)
    if (!uploadToken) return
    const controller = new AbortController()
    uploadControllerRef.current = controller
    setDragActive(false)
    setUploading(true)
    setProgress(0)
    setFeedback(null)
    try {
      const result = await uploadImport(file, {
        signal: controller.signal,
        onProgress(value) {
          if (canHandleUploadCallback(uploadInFlightRef, mountedRef, uploadToken)) {
            setProgress(value)
          }
        },
      })
      if (!canHandleUploadCallback(uploadInFlightRef, mountedRef, uploadToken)) return
      setProgress(100)
      setFeedback({
        type: 'success',
        message: result.repeated
          ? 'Este archivo ya había sido importado. Se devolvió el resultado original sin duplicar datos.'
          : `Importación confirmada: ${result.import.cantidad_insertados} nuevos, ${result.import.cantidad_actualizados} actualizados y ${result.import.cantidad_omitidos} sin cambios.`,
      })
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setPage(1)
      await loadHistory(1)
    } catch (error) {
      if (!canHandleUploadCallback(uploadInFlightRef, mountedRef, uploadToken)) return
      if (isImportsRequestCanceled(error)) {
        setFeedback({ type: 'warning', message: CANCELED_UPLOAD_NOTICE })
        setPage(1)
        await loadHistory(1)
        return
      }
      setFeedback({
        type: 'error',
        message: error.message || 'No fue posible completar la importación.',
        details: error.details,
      })
      if (isImportsAccessError(error)) onAccessError?.(error)
    } finally {
      if (uploadControllerRef.current === controller) uploadControllerRef.current = null
      if (finishUpload(uploadInFlightRef, uploadToken) && mountedRef.current) {
        setUploading(false)
      }
    }
  }

  function cancelUpload() {
    uploadControllerRef.current?.abort()
  }

  async function openDetail(importId, trigger) {
    if (!mountedRef.current || uploadInFlightRef.current !== null) return
    detailRequestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = detailRequestRef.current.sequence + 1
    detailRequestRef.current = { sequence, controller }
    detailTriggerRef.current = trigger
    setDetail({ loading: true, item: null, error: null })
    try {
      const item = await getImport(importId, { signal: controller.signal })
      if (!mountedRef.current || detailRequestRef.current.sequence !== sequence) return
      setDetail({ loading: false, item, error: null })
    } catch (error) {
      if (
        isImportsRequestCanceled(error) ||
        !mountedRef.current ||
        detailRequestRef.current.sequence !== sequence
      ) return
      setDetail({
        loading: false,
        item: null,
        error: error.message || 'No fue posible cargar el detalle.',
      })
      if (isImportsAccessError(error)) onAccessError?.(error)
    }
  }

  function closeDetail() {
    detailRequestRef.current.controller?.abort()
    detailRequestRef.current = {
      sequence: detailRequestRef.current.sequence + 1,
      controller: null,
    }
    setDetail(null)
    const trigger = detailTriggerRef.current
    detailTriggerRef.current = null
    window.requestAnimationFrame(() => {
      if (mountedRef.current) trigger?.focus()
    })
  }

  function changePage(nextPage) {
    if (historyLoading || uploading || nextPage < 1 || nextPage > (meta?.totalPages ?? 1)) return
    setPage(nextPage)
    void loadHistory(nextPage)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="data-import-title">
      <div>
        <h2 id="data-import-title" className="text-base font-semibold text-slate-800">
          Carga de datos
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
          Importe solicitudes y citas desde CSV o JSON UTF-8. El archivo completo se valida antes de guardar cualquier cambio.
        </p>
      </div>

      <form onSubmit={submit} className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <label htmlFor="data-import-file" className="block text-sm font-medium text-slate-800">
          Archivo CSV o JSON
        </label>
        <p id="data-import-help" className="mt-1 text-sm text-slate-600">
          Máximo 5 MiB y 50.000 registros. Use únicamente el contrato v1.0 sin datos personales ni clínicos.
        </p>
        <div
          onDragEnter={dragEnter}
          onDragOver={dragOver}
          onDragLeave={dragLeave}
          onDrop={dropFile}
          aria-busy={uploading}
          className={`mt-3 rounded-xl border-2 border-dashed p-4 transition-colors duration-200 ${
            dragActive
              ? 'border-brand-600 bg-brand-50'
              : 'border-slate-300 bg-white'
          } ${uploading ? 'opacity-60' : ''}`}
        >
          <p className="text-sm font-medium text-slate-800">
            Arrastre un único archivo aquí o selecciónelo con el control siguiente.
          </p>
          <input
            id="data-import-file"
            ref={fileInputRef}
            name="archivo"
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={selectFile}
            disabled={uploading}
            aria-describedby="data-import-help"
            className="mt-3 block min-h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white text-base text-slate-700 file:mr-4 file:min-h-11 file:border-0 file:bg-brand-600 file:px-4 file:font-medium file:text-white disabled:cursor-not-allowed disabled:opacity-60"
          />
          {file && (
            <p className="mt-3 break-all text-sm text-slate-700" role="status">
              Seleccionado: <strong>{file.name}</strong> ({formatImportFileSize(file.size)})
            </p>
          )}
        </div>

        {uploading && (
          <div className="mt-3" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-sm text-slate-700">
              <span>Enviando y validando archivo</span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <progress className="mt-2 h-2 w-full accent-brand-600" max="100" value={progress}>
              {progress}%
            </progress>
            <p className="mt-2 text-sm text-slate-600">
              “Cancelar espera” detiene la espera en este navegador; el servidor puede completar la importación.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={!file || uploading}
            className="min-h-11 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {uploading ? 'Importando…' : 'Validar e importar'}
          </button>
          {uploading && (
            <button
              type="button"
              onClick={cancelUpload}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-600 cursor-pointer"
            >
              Cancelar espera
            </button>
          )}
        </div>
      </form>

      {feedback && (
        <div
          ref={feedbackRef}
          tabIndex={-1}
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`mt-4 rounded-xl border px-4 py-3 ${
            feedback.type === 'error'
              ? 'border-critical-100 bg-white text-critical-600'
              : feedback.type === 'warning'
                ? 'border-warn-100 bg-white text-warn-600'
                : 'border-brand-100 bg-brand-50 text-brand-700'
          }`}
        >
          <p className="text-sm font-medium">{feedback.message}</p>
          <ImportErrors details={feedback.details} />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Historial de importaciones</h3>
          <p className="mt-1 text-sm text-slate-600">Solo se muestran lotes confirmados.</p>
        </div>
        <button
          type="button"
          onClick={() => loadHistory(page)}
          disabled={historyLoading || uploading}
          className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          Actualizar historial
        </button>
      </div>

      {historyError && (
        <p className="mt-3 rounded-lg border border-critical-100 p-3 text-sm text-critical-600" role="alert">
          {historyError}
        </p>
      )}

      <div className="mt-3 space-y-3 md:hidden">
        {history.map((item) => (
          <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="break-all text-sm font-semibold text-slate-900">{item.nombre_archivo}</h4>
            <p className="mt-1 text-sm text-slate-600">
              {formatDate(item.importado_en)} · {item.nombre_usuario || item.usuario || 'Cuenta eliminada'}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-600">Registros</dt><dd className="font-semibold tabular-nums text-slate-900">{item.cantidad_registros}</dd></div>
              <div><dt className="text-slate-600">Nuevos</dt><dd className="font-semibold tabular-nums text-slate-900">{item.cantidad_insertados}</dd></div>
              <div><dt className="text-slate-600">Actualizados</dt><dd className="font-semibold tabular-nums text-slate-900">{item.cantidad_actualizados}</dd></div>
              <div><dt className="text-slate-600">Sin cambios</dt><dd className="font-semibold tabular-nums text-slate-900">{item.cantidad_omitidos}</dd></div>
            </dl>
            <button
              type="button"
              onClick={(event) => openDetail(item.id, event.currentTarget)}
              disabled={uploading}
              className="mt-4 min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              Ver detalle
            </button>
          </article>
        ))}
        {!historyLoading && history.length === 0 && (
          <p className="rounded-xl border border-slate-200 px-4 py-8 text-center text-sm text-slate-600">
            Todavía no hay importaciones manuales confirmadas.
          </p>
        )}
        {historyLoading && (
          <p className="rounded-xl border border-slate-200 px-4 py-8 text-center text-sm text-slate-600" role="status">
            Cargando historial…
          </p>
        )}
      </div>

      <div className="mt-3 hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <caption className="sr-only">Lotes de importación manual confirmados</caption>
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">Fecha</th>
              <th scope="col" className="px-3 py-3 font-semibold">Archivo</th>
              <th scope="col" className="px-3 py-3 font-semibold">Registros</th>
              <th scope="col" className="px-3 py-3 font-semibold">Nuevos</th>
              <th scope="col" className="px-3 py-3 font-semibold">Actualizados</th>
              <th scope="col" className="px-3 py-3 font-semibold">Sin cambios</th>
              <th scope="col" className="px-3 py-3 font-semibold">Responsable</th>
              <th scope="col" className="px-3 py-3 font-semibold">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
            {history.map((item) => (
              <tr key={item.id}>
                <td className="whitespace-nowrap px-3 py-3">{formatDate(item.importado_en)}</td>
                <td className="max-w-64 break-all px-3 py-3 font-medium text-slate-900">{item.nombre_archivo}</td>
                <td className="px-3 py-3 tabular-nums">{item.cantidad_registros}</td>
                <td className="px-3 py-3 tabular-nums">{item.cantidad_insertados}</td>
                <td className="px-3 py-3 tabular-nums">{item.cantidad_actualizados}</td>
                <td className="px-3 py-3 tabular-nums">{item.cantidad_omitidos}</td>
                <td className="px-3 py-3">{item.nombre_usuario || item.usuario || 'Cuenta eliminada'}</td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={(event) => openDetail(item.id, event.currentTarget)}
                    disabled={uploading}
                    className="min-h-11 whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
            {!historyLoading && history.length === 0 && (
              <tr>
                <td colSpan="8" className="px-4 py-8 text-center text-slate-600">
                  Todavía no hay importaciones manuales confirmadas.
                </td>
              </tr>
            )}
            {historyLoading && (
              <tr>
                <td colSpan="8" className="px-4 py-8 text-center text-slate-600" role="status">
                  Cargando historial…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <section
          ref={detailPanelRef}
          tabIndex={-1}
          aria-labelledby="import-detail-title"
          className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-4 focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="import-detail-title" className="text-base font-semibold text-slate-900">
                Detalle de importación
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Resumen confirmado del lote manual seleccionado.
              </p>
            </div>
            <button
              type="button"
              onClick={closeDetail}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-600 cursor-pointer"
            >
              Cerrar detalle
            </button>
          </div>

          {detail.loading && <p className="mt-4 text-sm text-slate-700" role="status">Cargando detalle…</p>}
          {detail.error && <p className="mt-4 text-sm text-critical-600" role="alert">{detail.error}</p>}
          {detail.item && (
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-slate-600">Archivo</dt><dd className="break-all font-semibold text-slate-900">{detail.item.nombre_archivo}</dd></div>
              <div><dt className="text-slate-600">Formato</dt><dd className="font-semibold uppercase text-slate-900">{detail.item.formato}</dd></div>
              <div><dt className="text-slate-600">Confirmada</dt><dd className="font-semibold text-slate-900">{formatDate(detail.item.importado_en)}</dd></div>
              <div><dt className="text-slate-600">Responsable</dt><dd className="font-semibold text-slate-900">{detail.item.nombre_usuario || detail.item.usuario || 'Cuenta eliminada'}</dd></div>
              <div><dt className="text-slate-600">Registros</dt><dd className="font-semibold tabular-nums text-slate-900">{detail.item.cantidad_registros}</dd></div>
              <div><dt className="text-slate-600">Nuevos</dt><dd className="font-semibold tabular-nums text-slate-900">{detail.item.cantidad_insertados}</dd></div>
              <div><dt className="text-slate-600">Actualizados</dt><dd className="font-semibold tabular-nums text-slate-900">{detail.item.cantidad_actualizados}</dd></div>
              <div><dt className="text-slate-600">Sin cambios</dt><dd className="font-semibold tabular-nums text-slate-900">{detail.item.cantidad_omitidos}</dd></div>
            </dl>
          )}
        </section>
      )}

      {(meta?.totalPages ?? 0) > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Paginación del historial">
          <button
            type="button"
            onClick={() => changePage(page - 1)}
            disabled={page <= 1 || historyLoading || uploading}
            className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Anterior
          </button>
          <span className="text-sm text-slate-600" aria-live="polite">
            Página {page} de {meta.totalPages}
          </span>
          <button
            type="button"
            onClick={() => changePage(page + 1)}
            disabled={page >= meta.totalPages || historyLoading || uploading}
            className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Siguiente
          </button>
        </nav>
      )}
    </section>
  )
}

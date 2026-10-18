import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  getCurrentUser,
  isAuthenticationRequiredError,
  isAuthRequestCanceled,
  login as loginRequest,
  logout as logoutRequest,
} from '../api/auth.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('checking')
  const [sessionError, setSessionError] = useState(null)
  const [sessionNotice, setSessionNotice] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const mountedRef = useRef(false)
  const userRef = useRef(null)
  const verificationRef = useRef(null)
  const verificationSequenceRef = useRef(0)
  const actionRef = useRef(null)

  const updateSession = useCallback((nextUser, nextStatus) => {
    userRef.current = nextUser
    setUser(nextUser)
    setStatus(nextStatus)
  }, [])

  const checkSession = useCallback(({ blocking = false } = {}) => {
    if (actionRef.current) {
      return actionRef.current.promise.then(() => userRef.current)
    }

    const activeVerification = verificationRef.current

    if (activeVerification && (!blocking || activeVerification.blocking)) {
      return activeVerification.promise
    }

    activeVerification?.controller.abort()

    const id = verificationSequenceRef.current + 1
    verificationSequenceRef.current = id
    const controller = new AbortController()

    if (blocking) setStatus('checking')
    setSessionError(null)

    const promise = (async () => {
      try {
        const currentUser = await getCurrentUser({ signal: controller.signal })

        if (!mountedRef.current || verificationRef.current?.id !== id) return null

        const hadAuthenticatedUser = Boolean(userRef.current)
        updateSession(currentUser, currentUser ? 'authenticated' : 'anonymous')
        setSessionNotice(
          !currentUser && hadAuthenticatedUser
            ? 'La sesión expiró. Inicie sesión nuevamente.'
            : null,
        )
        return currentUser
      } catch (error) {
        if (
          isAuthRequestCanceled(error) ||
          !mountedRef.current ||
          verificationRef.current?.id !== id
        ) {
          return null
        }

        if (blocking) {
          setSessionError(error.message)
          setStatus('error')
        }
        throw error
      } finally {
        if (verificationRef.current?.id === id) verificationRef.current = null
      }
    })()

    verificationRef.current = { id, controller, promise, blocking }
    return promise
  }, [updateSession])

  useEffect(() => {
    mountedRef.current = true
    void checkSession({ blocking: true }).catch(() => {})

    return () => {
      mountedRef.current = false
      verificationRef.current?.controller.abort()
      actionRef.current?.controller.abort()
      verificationRef.current = null
      actionRef.current = null
      verificationSequenceRef.current += 1
    }
  }, [checkSession])

  const login = useCallback((usuario, password) => {
    if (actionRef.current) return actionRef.current.promise

    verificationRef.current?.controller.abort()
    verificationRef.current = null
    verificationSequenceRef.current += 1

    const controller = new AbortController()
    setPendingAction('login')
    setSessionError(null)
    setSessionNotice(null)

    const promise = (async () => {
      try {
        const authenticatedUser = await loginRequest(usuario, password, {
          signal: controller.signal,
        })

        if (mountedRef.current) updateSession(authenticatedUser, 'authenticated')
        return authenticatedUser
      } catch (error) {
        if (isAuthRequestCanceled(error)) return null

        if (mountedRef.current) updateSession(null, 'anonymous')
        throw error
      } finally {
        if (actionRef.current?.promise === promise) {
          actionRef.current = null
          if (mountedRef.current) setPendingAction(null)
        }
      }
    })()

    actionRef.current = { type: 'login', controller, promise }
    return promise
  }, [updateSession])

  const logout = useCallback(() => {
    if (actionRef.current) return actionRef.current.promise

    verificationRef.current?.controller.abort()
    verificationRef.current = null
    verificationSequenceRef.current += 1

    const controller = new AbortController()
    setPendingAction('logout')

    const promise = (async () => {
      try {
        await logoutRequest({ signal: controller.signal })

        if (mountedRef.current) {
          updateSession(null, 'anonymous')
          setSessionNotice(null)
        }
      } catch (error) {
        if (isAuthRequestCanceled(error)) return

        if (mountedRef.current && isAuthenticationRequiredError(error)) {
          updateSession(null, 'anonymous')
          setSessionNotice(error.message)
        }
        throw error
      } finally {
        if (actionRef.current?.promise === promise) {
          actionRef.current = null
          if (mountedRef.current) setPendingAction(null)
        }
      }
    })()

    actionRef.current = { type: 'logout', controller, promise }
    return promise
  }, [updateSession])

  const value = useMemo(
    () => ({
      user,
      status,
      sessionError,
      sessionNotice,
      pendingAction,
      checkSession,
      login,
      logout,
    }),
    [
      user,
      status,
      sessionError,
      sessionNotice,
      pendingAction,
      checkSession,
      login,
      logout,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return context
}

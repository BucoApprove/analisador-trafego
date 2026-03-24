import { useState, useEffect, useRef, useCallback } from 'react'
import type { FetchState } from './types'

const REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutos

interface UseDashboardFetchOptions {
  enabled?: boolean
  refreshInterval?: number
}

export function useDashboardFetch<T>(
  url: string,
  token: string,
  { enabled = true, refreshInterval = REFRESH_INTERVAL }: UseDashboardFetchOptions = {}
): FetchState<T> & { refetch: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    status: 'idle',
    error: null,
    lastUpdated: null,
  })

  const hasFetched = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState(prev => ({ ...prev, status: 'loading', error: null }))

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })

      if (res.status === 401) {
        sessionStorage.removeItem('dashboard-token')
        window.location.reload()
        return
      }

      if (!res.ok) {
        throw new Error(`Erro ${res.status}: ${res.statusText}`)
      }

      const data: T = await res.json()
      setState({ data, status: 'success', error: null, lastUpdated: new Date() })
      hasFetched.current = true
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setState(prev => ({
        ...prev,
        status: 'error',
        error: (err as Error).message ?? 'Erro desconhecido',
      }))
    }
  }, [url, token])

  // Busca inicial — só quando a aba fica ativa e ainda não buscou
  useEffect(() => {
    if (!enabled || hasFetched.current) return
    fetchData()
  }, [enabled, fetchData])

  // Auto-refresh periódico
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(fetchData, refreshInterval)
    return () => clearInterval(id)
  }, [enabled, fetchData, refreshInterval])

  // Cleanup no unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  return { ...state, refetch: fetchData }
}

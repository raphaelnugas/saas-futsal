import axios from 'axios'
import { logError } from './logger'

const resolveBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    const trimmed = envUrl.trim().replace(/\/+$/, '')
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
  }
  if (typeof window !== 'undefined') {
    return '/api'
  }
  return 'http://localhost:3001/api'
}

const API_BASE_URL = resolveBaseUrl()

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    if (typeof config.url === 'string') {
      config.url = config.url.replace(/^\/api(\/|$)/, '/')
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Retry logic with exponential backoff
api.interceptors.response.use(
  (response) => {
    return response
  },
  async (error) => {
    const config = error.config
    
    // Configurações de retry
    if (!config || !config.retry) {
      config.retry = 0
    }
    
    const MAX_RETRIES = 3
    const status = error.response?.status
    
    // Tenta retry apenas para erros de rede ou 429/5xx, exceto se já atingiu o limite
    if ((!status || status === 429 || status >= 500) && config.retry < MAX_RETRIES) {
      config.retry += 1
      
      // Backoff exponencial: 1s, 2s, 4s... com jitter aleatório
      const backoff = Math.pow(2, config.retry) * 1000
      const jitter = Math.random() * 1000
      const delay = backoff + jitter
      
      console.warn(`[api:retry] Tentativa ${config.retry}/${MAX_RETRIES} para ${config.url} em ${Math.round(delay)}ms. Status: ${status || 'network'}`)
      
      await new Promise(resolve => setTimeout(resolve, delay))
      return api(config)
    }

    if (status === 401) {
      const url = error.config?.url || ''
      if (url.includes('/api/auth/verify') || url.includes('/api/auth/login')) {
        localStorage.removeItem('token')
        window.location.href = '/login'
      }
    }
    if (status === 429) {
      console.warn('[api:429] Rate limit exceeded', { url: error.config?.url, method: error.config?.method })
    } else {
      logError('api_response_error', {
        status,
        url: error.config?.url,
        method: error.config?.method
      })
    }
    return Promise.reject(error)
  }
)

export default api

import axios from 'axios'
import { logError } from './logger'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    const status = error.response?.status
    if (status === 401) {
      const url = error.config?.url || ''
      // Evitar queda de login automática em chamadas não relacionadas à autenticação
      // Somente redireciona se a verificação de sessão falhar explicitamente
      if (url.includes('/api/auth/verify') || url.includes('/api/auth/login')) {
        localStorage.removeItem('token')
        window.location.href = '/login'
      }
    }
    if (status === 429) {
      console.warn('[api:429]', { url: error.config?.url, method: error.config?.method })
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

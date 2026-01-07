import React from 'react'
import type { AxiosInstance } from 'axios'
import api from '../services/api'

const Regras: React.FC = () => {
  const base = ((api as AxiosInstance).defaults.baseURL) || ''
  const token = typeof window !== 'undefined' ? (localStorage.getItem('token') || '') : ''
  const src = base.endsWith('/api')
    ? `${base}/assets/rules?token=${encodeURIComponent(token)}`
    : `${base}/api/assets/rules?token=${encodeURIComponent(token)}`

  return (
    <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 -my-6">
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="absolute z-10 top-3 right-3 inline-flex items-center px-3 py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 shadow"
      >
        Baixar PDF
      </a>
      <object
        data={src}
        type="application/pdf"
        className="w-screen h-[calc(100vh-4rem)]"
      >
        <div className="p-4">
          <p className="text-sm text-gray-700">
            Seu navegador não suporta visualização de PDF embutido.
          </p>
          <a href={src} target="_blank" rel="noreferrer" className="text-primary-600 underline">
            Abrir o documento em uma nova aba
          </a>
        </div>
      </object>
    </div>
  )
}

export default Regras

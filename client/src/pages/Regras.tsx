import React from 'react'
import type { AxiosInstance } from 'axios'
import api from '../services/api'
import { FileText } from 'lucide-react'

const Regras: React.FC = () => {
  const base = ((api as AxiosInstance).defaults.baseURL) || ''
  const token = typeof window !== 'undefined' ? (localStorage.getItem('token') || '') : ''
  const src = base.endsWith('/api')
    ? `${base}/assets/rules?token=${encodeURIComponent(token)}`
    : `${base}/api/assets/rules?token=${encodeURIComponent(token)}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <FileText className="w-7 h-7 text-primary-600 mr-2" />
          Regras
        </h1>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          Baixar PDF
        </a>
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <object
          data={src}
          type="application/pdf"
          className="w-full min-h-[65vh] lg:min-h-[75vh]"
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
    </div>
  )
}

export default Regras

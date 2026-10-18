import { useId } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const BRAND = '#0f6b5c'
const BRAND_SOFT = '#daede6'
const AXIS_TEXT = '#475569'

function CustomTooltip({ active, payload, label, formatValue }) {
  if (!active || !payload?.length) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md"
    >
      <p className="text-slate-500">{label}</p>
      <p className="font-semibold text-slate-900 tabular-nums">{formatValue(payload[0].value)}</p>
    </div>
  )
}

export default function GraficoTendencia({ title, data, formatValue = (v) => v }) {
  const titleId = useId()
  const gradientId = useId().replaceAll(':', '')

  return (
    <figure className="rounded-xl bg-white border border-slate-200 p-5 shadow-sm" aria-labelledby={titleId}>
      <figcaption id={titleId} className="text-sm font-semibold text-slate-700 mb-3">{title}</figcaption>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart
          accessibilityLayer
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          title={`${title}. Use las flechas izquierda y derecha para recorrer los períodos.`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND} stopOpacity={0.25} />
              <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eef2f0" vertical={false} />
          <XAxis
            dataKey="periodo"
            tick={{ fontSize: 12, fill: AXIS_TEXT }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: AXIS_TEXT }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={formatValue}
          />
          <Tooltip content={<CustomTooltip formatValue={formatValue} />} />
          <Area
            type="monotone"
            dataKey="valor"
            stroke={BRAND}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={{ r: 3, fill: BRAND, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: BRAND, stroke: BRAND_SOFT, strokeWidth: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <details className="mt-3 text-sm text-slate-700">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2">
          Ver datos en tabla
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Datos de {title}</caption>
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th scope="col" className="py-2 pr-4 font-medium">Período</th>
                <th scope="col" className="py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.periodo} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="py-2 pr-4 font-normal">{item.periodo}</th>
                  <td className="py-2 text-right tabular-nums">{formatValue(item.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

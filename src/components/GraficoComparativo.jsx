import { useId } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// Distinct hues, explicit labels, and a table keep both series identifiable
// without relying on color alone.
const AGENDADAS = '#b45309'
const UTILIZADAS = '#0f6b5c'
const AXIS_TEXT = '#475569'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md"
    >
      <p className="text-slate-500 mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="tabular-nums" style={{ color: entry.color }}>
          {entry.name}: <span className="font-semibold">{entry.value}</span>
        </p>
      ))}
    </div>
  )
}

export default function GraficoComparativo({ title, data }) {
  const titleId = useId()

  return (
    <figure className="rounded-xl bg-white border border-slate-200 p-5 shadow-sm" aria-labelledby={titleId}>
      <figcaption id={titleId} className="text-sm font-semibold text-slate-700 mb-3">{title}</figcaption>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          accessibilityLayer
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barGap={4}
          title={`${title}. Use las flechas izquierda y derecha para recorrer los períodos.`}
        >
          <CartesianGrid stroke="#eef2f0" vertical={false} />
          <XAxis dataKey="periodo" tick={{ fontSize: 12, fill: AXIS_TEXT }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: AXIS_TEXT }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, color: AXIS_TEXT }}
            formatter={(value) => (value === 'agendadas' ? 'Horas agendadas' : 'Horas utilizadas')}
          />
          <Bar dataKey="agendadas" fill={AGENDADAS} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="utilizadas" fill={UTILIZADAS} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
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
                <th scope="col" className="px-2 py-2 text-right font-medium">Horas agendadas</th>
                <th scope="col" className="py-2 pl-2 text-right font-medium">Horas utilizadas</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.periodo} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="py-2 pr-4 font-normal">{item.periodo}</th>
                  <td className="px-2 py-2 text-right tabular-nums">{item.agendadas}</td>
                  <td className="py-2 pl-2 text-right tabular-nums">{item.utilizadas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

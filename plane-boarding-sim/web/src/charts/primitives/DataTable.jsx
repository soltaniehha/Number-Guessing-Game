/**
 * Table view — the WCAG-clean twin of every chart.
 *
 * This is what makes the two documented palette reliefs legal (a sub-3:1
 * series colour, and any colour-encoded magnitude): the numbers are always
 * reachable without reading a hue, and without hovering.
 */
export function DataTable({ columns, rows, caption }) {
  const cols = columns ?? []
  const data = rows ?? []
  return (
    <div className="ch-table-wrap">
      <table className="ch-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} scope="col" style={{ textAlign: c.align ?? 'left' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={cols.length || 1} className="ch-table-empty">
                No results yet.
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr key={row.key ?? i}>
                {cols.map((c, j) => (
                  <td
                    key={c.key}
                    style={{ textAlign: c.align ?? (j === 0 ? 'left' : 'right') }}
                    className={j === 0 ? undefined : 'num'}
                  >
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

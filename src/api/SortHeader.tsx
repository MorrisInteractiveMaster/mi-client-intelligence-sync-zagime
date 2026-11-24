import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { compareValues, type SortDirection, type SortValue } from "../projects/sort";

export type SortState<Key extends string> = { key: Key; direction: SortDirection };
export function nextSort<Key extends string>(current: SortState<Key> | undefined, key: Key): SortState<Key> {
  return { key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" };
}

export function SortHeader<Key extends string>({ field, sort, onSort, label, disabled }: {
  field: Key; sort?: SortState<Key>; onSort: (value: SortState<Key>) => void; label: string; disabled?: boolean;
}) {
  const direction = field === sort?.key ? sort.direction : undefined;
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return <th scope="col" aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined}>
    <button type="button" className="exec-text-button mi-sort-header" disabled={disabled}
      onClick={() => onSort(nextSort(sort, field))}>{label}<Icon size={14} aria-hidden="true" /></button>
  </th>;
}

export function useSortedRows<Row, Key extends string>(
  rows: readonly Row[], initial: SortState<Key>, value: (row: Row, key: Key) => SortValue, identity: (row: Row) => string,
) {
  const [sort, setSort] = useState(initial);
  return { sort, setSort, rows: [...rows].sort((a, b) =>
    compareValues(value(a, sort.key), value(b, sort.key), sort.direction) || compareValues(identity(a), identity(b))) };
}

export function SortControls<Key extends string>({ fields, sort, onSort, label = "Sort by", disabled }: {
  fields: Readonly<Record<Key, string>>; sort: SortState<Key>; onSort: (value: SortState<Key>) => void; label?: string; disabled?: boolean;
}) {
  return <div className="mi-sort-controls">
    <label>{label}<select value={sort.key} disabled={disabled} onChange={event => onSort({ ...sort, key: event.target.value as Key })}>
      {(Object.keys(fields) as Key[]).map(key => <option key={key} value={key}>{fields[key]}</option>)}</select></label>
    <button className="exec-text-button mi-sort-direction" type="button" disabled={disabled}
      aria-label={sort.direction === "asc" ? "Sort descending" : "Sort ascending"}
      onClick={() => onSort({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })}>
      {sort.direction === "asc" ? <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}
      {sort.direction === "asc" ? "Ascending" : "Descending"}</button>
  </div>;
}

export function SortedTable<Row, Key extends string>({ rows, columns, initial, value, identity, cells, caption, className }: {
  rows: readonly Row[]; columns: Readonly<Record<Key, string>>; initial: SortState<NoInfer<Key>>;
  value: (row: Row, key: Key) => SortValue; identity: (row: Row) => string; cells: (row: Row) => ReactNode;
  caption?: string; className?: string;
}) {
  const sorted = useSortedRows(rows, initial, value, identity);
  return <table className={className}>{caption && <caption>{caption}</caption>}
    <thead><tr>{(Object.keys(columns) as Key[]).map(field =>
      <SortHeader key={field} field={field} label={columns[field]} sort={sorted.sort} onSort={sorted.setSort} />)}</tr></thead>
    <tbody>{sorted.rows.map(row => <tr key={identity(row)}>{cells(row)}</tr>)}</tbody>
  </table>;
}

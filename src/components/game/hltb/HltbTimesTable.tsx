import {
  formatCount,
  formatDuration,
  type StyleRowData,
  type Translate,
} from "./hltbShared";

export function HltbTimesTable({
  rows,
  t,
}: {
  rows: StyleRowData[];
  t: Translate;
}) {
  return (
    <div className="hltb-table-wrap">
      <table className="hltb-table">
        <thead>
          <tr>
            <th>{t("hltb.style")}</th>
            <th>{t("hltb.average")}</th>
            <th>{t("hltb.median")}</th>
            <th>{t("hltb.fastest")}</th>
            <th>{t("hltb.slowest")}</th>
            <th>{t("hltb.submissionsShort")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="hltb-table__style">{row.label}</td>
              <td>{formatDuration(row.stat?.average)}</td>
              <td>{formatDuration(row.stat?.median)}</td>
              <td>{formatDuration(row.stat?.low)}</td>
              <td>{formatDuration(row.stat?.high)}</td>
              <td>{formatCount(row.stat?.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default HltbTimesTable;

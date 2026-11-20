import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type AnalysisRow,
  type UserInfo,
} from "../lib/api.ts";
import { formatLocalTime } from "../lib/format.ts";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

function severityBadge(sev: AnalysisRow["severity"]) {
  switch (sev) {
    case "normal":
      return <span className="badge badge-ok">正常</span>;
    case "warning":
      return <span className="badge badge-warn">警告</span>;
    case "critical":
      return <span className="badge badge-err">严重</span>;
    default:
      return <span className="badge badge-muted">未知 / 数据不足</span>;
  }
}

export function AnalysisView({
  results,
  canRun,
  running,
  onRun,
}: {
  results: AnalysisRow[];
  canRun: boolean;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>健康评分与分析（Haskell 引擎计算）</h2>
        {canRun && (
          <button type="button" className="btn" disabled={running} onClick={onRun}>
            {running ? "分析中..." : "立即运行分析"}
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <EmptyState
          title="尚无健康分析结果"
          description="请确保 Haskell 健康引擎运行，或点击「立即运行分析」触发一次评估。"
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>设备 ID</th>
                <th>严重级别</th>
                <th>可解释评分</th>
                <th>趋势</th>
                <th>阈值来源</th>
                <th>评分依据（因素 / 异常 / 关联）</th>
                <th>版本与时间</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.device_id}</td>
                  <td>{severityBadge(r.severity)}</td>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {r.score !== null ? `${r.score.toFixed(1)} / 100` : "— (无法评分)"}
                  </td>
                  <td className="mono">{r.trend}</td>
                  <td className="mono">{r.threshold_source}</td>
                  <td>
                    {r.factors.map((f, idx) => (
                      <div key={idx} style={{ fontSize: 12 }}>
                        <span className="mono">
                          [{f.metric} {f.delta >= 0 ? `+${f.delta}` : f.delta}]
                        </span>{" "}
                        {f.reason}
                      </div>
                    ))}
                    {r.anomalies.map((a, idx) => (
                      <div key={`a-${idx}`} style={{ fontSize: 12, color: "#fcd34d" }}>
                        异常 {a.code}: {a.reason}
                      </div>
                    ))}
                    {r.correlations.map((c, idx) => (
                      <div key={`c-${idx}`} style={{ fontSize: 12, color: "#fca5a5" }}>
                        关联 {c.code}: {c.summary}
                      </div>
                    ))}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    <div className="mono">
                      engine={r.engine_version} · {r.rule_version}
                    </div>
                    <div>{formatLocalTime(r.analyzed_at)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AnalysisPage({ user }: { user: UserInfo }) {
  const [results, setResults] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .analysis()
      .then((res) => setResults(res.results))
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRun = () => {
    setRunning(true);
    setError(null);
    api
      .runAnalysis()
      .then(() => load())
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      )
      .finally(() => setRunning(false));
  };

  if (loading) return <LoadingState message="正在加载健康分析结果..." />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  return (
    <AnalysisView
      results={results}
      canRun={user.role === "admin"}
      running={running}
      onRun={handleRun}
    />
  );
}

'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JsonSchema } from '@cepage/shared-core';
import { apiPost } from '@cepage/client-api';
import { Button, Badge } from '@cepage/ui-kit';
import { ParameterEditor } from '@cepage/app-ui';

type CompilationState = 'proposed' | 'reviewing' | 'approved' | 'rejected';

type ParameterInferredType = 'string' | 'number' | 'boolean' | 'secret';

type DetectedParameter = {
  name: string;
  originalValue: string;
  inferredType: ParameterInferredType;
  isSecret: boolean;
  suggestedDefault: string;
};

type CompilationReport = {
  parameters: DetectedParameter[];
  estimatedCost: number;
  graphStats: { nodes: number; edges: number };
  warnings: string[];
};

type CompilationSkill = {
  slug: string;
  title: string;
  summary: string;
  kind: string;
  tags: string[];
  category: string;
  inputsSchema: JsonSchema;
  outputsSchema: JsonSchema;
  graphJson: Record<string, unknown>;
  execution: Record<string, unknown> | null;
  sourceSessionId: string;
  visibility: string;
};

type CompilationProposal = {
  skill: CompilationSkill;
  report: CompilationReport;
};

const IGNORED_SESSIONS_KEY = 'cepage:skill-compiler:ignored-sessions';

function loadIgnoredSessions(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(IGNORED_SESSIONS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function saveIgnoredSessions(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(IGNORED_SESSIONS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    return;
  }
}

async function getCompilationProposal(
  sessionId: string,
  agentType: 'opencode' | 'cursor' = 'opencode',
  sessionData?: string,
) {
  return apiPost<CompilationProposal>(`/api/v1/skill-compiler/compile`, {
    sessionId,
    agentType,
    mode: 'draft',
    ...(sessionData ? { sessionData } : {}),
  });
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--z-bg-app)',
  color: 'var(--z-fg)',
  padding: 24,
  fontFamily: 'system-ui, sans-serif',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 12,
  marginBottom: 20,
};

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--z-section-border)',
  background: 'var(--z-section-bg)',
  borderRadius: 10,
  padding: 14,
};

const cardGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 12,
};

const statCardStyle: React.CSSProperties = {
  ...sectionStyle,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'flex-start',
};

const monoStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  overflow: 'auto',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--z-section-border)',
  color: 'var(--z-fg-muted)',
  fontWeight: 600,
  fontSize: 12,
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--z-border-muted, rgba(255,230,235,0.08))',
  color: 'var(--z-fg)',
};

const comparisonGridStyle: React.CSSProperties = {
  display: 'grid',
  gap: 14,
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
};

const actionBarStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  alignItems: 'center',
  marginTop: 20,
  paddingTop: 14,
  borderTop: '1px solid var(--z-section-border)',
};

export default function CompilationReviewPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Array.isArray(params?.sessionId)
    ? params.sessionId[0]
    : params?.sessionId ?? '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionData = searchParams?.get('sessionData') ?? undefined;

  const [state, setState] = useState<CompilationState>('proposed');
  const [ignoredSessions, setIgnoredSessions] = useState<Set<string>>(loadIgnoredSessions);
  const [proposal, setProposal] = useState<CompilationProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showIgnoreConfirm, setShowIgnoreConfirm] = useState(false);
  const [editedSchema, setEditedSchema] = useState<JsonSchema | null>(null);

  const isIgnored = useMemo(() => ignoredSessions.has(sessionId), [ignoredSessions, sessionId]);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    const res = await getCompilationProposal(sessionId, 'opencode', sessionData);
    setLoading(false);
    if (!res.success) {
      setError(res.error.message);
      return;
    }
    setProposal(res.data);
    setState('proposed');
  }, [sessionId, sessionData]);

  useEffect(() => {
    void load();
  }, [load]);

  const onEditParameters = useCallback(() => {
    setEditedSchema(proposal?.skill.inputsSchema ?? null);
    setState('reviewing');
  }, [proposal]);

  const onCancelEdit = useCallback(() => {
    setState('proposed');
  }, []);

  const onCompile = useCallback(async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setError(null);
    const res = await apiPost<CompilationProposal>(`/api/v1/skill-compiler/compile`, {
      sessionId,
      agentType: 'opencode',
      mode: 'publish',
      ...(sessionData ? { sessionData } : {}),
      ...(state === 'reviewing' && editedSchema ? { inputsSchema: editedSchema } : {}),
    });
    setBusy(false);
    if (!res.success) {
      setError(res.error.message);
      return;
    }
    setState('approved');
    if (res.data.skill.slug) {
      router.push(`/library/${encodeURIComponent(res.data.skill.slug)}`);
    } else {
      router.push('/library');
    }
  }, [sessionId, busy, router, state, editedSchema, sessionData]);

  const onIgnore = useCallback(() => {
    setShowIgnoreConfirm(true);
  }, []);

  const confirmIgnore = useCallback(() => {
    const next = new Set(ignoredSessions);
    next.add(sessionId);
    setIgnoredSessions(next);
    saveIgnoredSessions(next);
    setState('rejected');
    setShowIgnoreConfirm(false);
    router.push('/');
  }, [ignoredSessions, sessionId, router]);

  const cancelIgnore = useCallback(() => {
    setShowIgnoreConfirm(false);
  }, []);

  const onReviewGraph = useCallback(() => {
    if (!sessionId) return;
    router.push(`/?session=${encodeURIComponent(sessionId)}`);
  }, [sessionId, router]);

  const originalNodes = useMemo(() => {
    if (!proposal) return [];
    const graph = proposal.skill.graphJson;
    if (!graph || typeof graph !== 'object') return [];
    const nodes = (graph as { nodes?: unknown[] }).nodes;
    return Array.isArray(nodes) ? nodes : [];
  }, [proposal]);

  const parameterizedPreview = useMemo(() => {
    if (!proposal) return [];
    const graph = proposal.skill.graphJson;
    if (!graph || typeof graph !== 'object') return [];
    const nodes = (graph as { nodes?: Array<{ content?: Record<string, unknown> }> }).nodes;
    if (!Array.isArray(nodes)) return [];
    return nodes.map((node) => {
      const content = node.content ?? {};
      const parameterized: Record<string, string> = {};
      for (const [key, value] of Object.entries(content)) {
        if (typeof value === 'string') {
          parameterized[key] = value;
        }
      }
      return parameterized;
    });
  }, [proposal]);

  if (isIgnored) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          <Link
            href="/"
            style={{
              padding: '6px 10px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--z-btn-ghost-border)',
              background: 'var(--z-btn-ghost-bg)',
              color: 'var(--z-btn-ghost-fg)',
              cursor: 'pointer',
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            ← Back
          </Link>
          <h1 style={{ fontSize: 22, margin: 0 }}>Compilation Review</h1>
        </header>
        <section style={sectionStyle}>
          <p style={{ color: 'var(--z-fg-muted)', fontSize: 13, margin: 0 }}>
            This session was ignored and cannot be proposed for compilation again.
          </p>
        </section>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Compilation Proposal</h1>
          <Badge tone="neutral" outline>
            {state}
          </Badge>
        </header>
        <p style={{ color: 'var(--z-fg-muted)' }}>Analyzing session…</p>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          <Link
            href="/"
            style={{
              padding: '6px 10px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--z-btn-ghost-border)',
              background: 'var(--z-btn-ghost-bg)',
              color: 'var(--z-btn-ghost-fg)',
              cursor: 'pointer',
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            ← Back
          </Link>
          <h1 style={{ fontSize: 22, margin: 0 }}>Compilation Proposal</h1>
          <Badge tone="neutral" outline>
            {state}
          </Badge>
        </header>
        <p style={{ color: 'var(--z-fg-status)' }}>
          {error ?? 'No compilation proposal available.'}
        </p>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const { skill, report } = proposal;

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link
          href="/"
          style={{
            padding: '6px 10px',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid var(--z-btn-ghost-border)',
            background: 'var(--z-btn-ghost-bg)',
            color: 'var(--z-btn-ghost-fg)',
            cursor: 'pointer',
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          ← Back
        </Link>
        <div style={{ flex: '1 1 auto', display: 'grid', gap: 4, minWidth: 0 }}>
          <h1 style={{ fontSize: 22, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            Compilation Proposal
            <Badge tone="accent" outline>
              {sessionId.slice(0, 8)}…
            </Badge>
          </h1>
          <p style={{ margin: 0, color: 'var(--z-fg-muted)', fontSize: 13 }}>
            {skill.title}
          </p>
        </div>
        <Badge
          tone={
            state === 'approved'
              ? 'success'
              : state === 'rejected'
                ? 'danger'
                : state === 'reviewing'
                  ? 'warning'
                  : 'neutral'
          }
          outline
        >
          {state}
        </Badge>
      </header>

      {state === 'proposed' && (
        <>
          <section style={{ marginBottom: 20 }}>
            <div style={cardGridStyle}>
              <StatCard label="Nodes" value={String(report.graphStats.nodes)} tone="info" />
              <StatCard label="Edges" value={String(report.graphStats.edges)} tone="info" />
              <StatCard label="Parameters" value={String(report.parameters.length)} tone="accent" />
              <StatCard label="Est. Cost" value={String(report.estimatedCost)} tone="success" />
            </div>
          </section>

          <section style={{ ...sectionStyle, marginBottom: 20 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>
              Detected Parameters ({report.parameters.length})
            </h2>
            {report.parameters.length === 0 ? (
              <p style={{ color: 'var(--z-fg-muted)', fontSize: 13 }}>
                No parameters were detected in this session.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Default</th>
                      <th style={thStyle}>Original Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.parameters.map((param) => (
                      <tr key={param.name}>
                        <td style={tdStyle}>
                          <code>{param.name}</code>
                          {param.isSecret ? (
                            <Badge tone="danger" outline style={{ marginLeft: 6 }}>
                              secret
                            </Badge>
                          ) : null}
                        </td>
                        <td style={tdStyle}>
                          <Badge tone="neutral">{param.inferredType}</Badge>
                        </td>
                        <td style={tdStyle}>
                          {param.suggestedDefault || (
                            <span style={{ color: 'var(--z-fg-muted)' }}>—</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <code style={{ color: 'var(--z-fg-muted)' }}>
                            {param.isSecret ? '[REDACTED]' : param.originalValue}
                          </code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={{ marginBottom: 20 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>
              Session Comparison
            </h2>
            <div style={comparisonGridStyle}>
              <div style={sectionStyle}>
                <h3
                  style={{
                    margin: '0 0 10px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--z-fg-muted)',
                  }}
                >
                  Original Session
                </h3>
                <div style={{ ...monoStyle, maxHeight: 320 }}>
                  {originalNodes.length === 0 ? (
                    <span style={{ color: 'var(--z-fg-muted)' }}>No nodes available.</span>
                  ) : (
                    originalNodes.map((node, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <span style={{ color: 'var(--z-fg-muted)' }}>#{i + 1}</span>{' '}
                        {JSON.stringify(node, null, 2)}
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div style={sectionStyle}>
                <h3
                  style={{
                    margin: '0 0 10px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--z-fg-muted)',
                  }}
                >
                  Parameterized Skill
                </h3>
                <div style={{ ...monoStyle, maxHeight: 320 }}>
                  {parameterizedPreview.length === 0 ? (
                    <span style={{ color: 'var(--z-fg-muted)' }}>No parameterized content.</span>
                  ) : (
                    parameterizedPreview.map((content, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <span style={{ color: 'var(--z-fg-muted)' }}>#{i + 1}</span>{' '}
                        {JSON.stringify(content, null, 2)}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          {report.warnings.length > 0 ? (
            <section style={{ ...sectionStyle, marginBottom: 20 }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Warnings</h2>
              <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, color: 'var(--z-fg-section)' }}>
                {report.warnings.map((warning, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {warning}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section style={{ marginBottom: 20 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Generated Schema</h2>
            <div style={comparisonGridStyle}>
              <div style={sectionStyle}>
                <h3
                  style={{
                    margin: '0 0 10px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--z-fg-muted)',
                  }}
                >
                  Inputs
                </h3>
                <pre style={{ ...monoStyle, margin: 0, maxHeight: 240 }}>
                  {JSON.stringify(skill.inputsSchema, null, 2)}
                </pre>
              </div>
              <div style={sectionStyle}>
                <h3
                  style={{
                    margin: '0 0 10px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--z-fg-muted)',
                  }}
                >
                  Outputs
                </h3>
                <pre style={{ ...monoStyle, margin: 0, maxHeight: 240 }}>
                  {JSON.stringify(skill.outputsSchema, null, 2)}
                </pre>
              </div>
            </div>
          </section>

          <section style={actionBarStyle}>
            <Button variant="primary" size="md" onClick={() => void onCompile()} disabled={busy}>
              {busy ? 'Compiling…' : 'Compile'}
            </Button>
            <Button variant="secondary" size="md" onClick={onEditParameters}>
              Edit Parameters
            </Button>
            <Button variant="secondary" size="md" onClick={onReviewGraph}>
              Review Graph
            </Button>
            <Button variant="ghost" size="md" onClick={onIgnore}>
              Ignore
            </Button>
            {busy ? (
              <span style={{ fontSize: 13, color: 'var(--z-fg-muted)' }}>
                Publishing skill…
              </span>
            ) : null}
          </section>
        </>
      )}

      {state === 'reviewing' && (
        <section style={{ display: 'grid', gap: 16 }}>
          <div style={sectionStyle}>
            <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>
              Review Parameters
            </h2>
            <ParameterEditor
              schema={editedSchema ?? skill.inputsSchema}
              onChange={(schema) => setEditedSchema(schema)}
            />
          </div>

          <section style={actionBarStyle}>
            <Button variant="primary" size="md" onClick={() => void onCompile()} disabled={busy}>
              {busy ? 'Compiling…' : 'Compile'}
            </Button>
            <Button variant="secondary" size="md" onClick={onCancelEdit}>
              Cancel
            </Button>
            <Button variant="ghost" size="md" onClick={onIgnore}>
              Ignore
            </Button>
            {busy ? (
              <span style={{ fontSize: 13, color: 'var(--z-fg-muted)' }}>
                Publishing skill…
              </span>
            ) : null}
          </section>
        </section>
      )}

      {state === 'approved' && (
        <section style={sectionStyle}>
          <p style={{ color: 'var(--z-fg-status-success)', fontSize: 13, margin: 0 }}>
            Compilation approved and published. Redirecting to skill detail…
          </p>
        </section>
      )}

      {state === 'rejected' && (
        <section style={sectionStyle}>
          <p style={{ color: 'var(--z-fg-muted)', fontSize: 13, margin: 0 }}>
            This session has been ignored. Redirecting…
          </p>
        </section>
      )}

      {showIgnoreConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={cancelIgnore}
        >
          <div
            style={{
              background: 'var(--z-bg-app)',
              border: '1px solid var(--z-section-border)',
              borderRadius: 10,
              padding: 20,
              maxWidth: 400,
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Ignore this session?</h3>
            <p style={{ fontSize: 13, color: 'var(--z-fg-section)', margin: '0 0 16px' }}>
              This will mark the session as ignored and prevent it from being proposed for compilation again.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="sm" onClick={cancelIgnore}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={confirmIgnore}>
                Ignore
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'info' | 'accent' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div style={statCardStyle}>
      <span style={{ fontSize: 11, color: 'var(--z-fg-muted)', fontWeight: 500 }}>{label}</span>
      <span
        style={{
          fontSize: 22,
          fontWeight: 700,
          color:
            tone === 'accent'
              ? 'var(--z-accent-strong)'
              : tone === 'success'
                ? 'var(--z-fg-status-success, #16a34a)'
                : 'var(--z-fg)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

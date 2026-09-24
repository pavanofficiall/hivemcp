'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Hexagon,
  LayoutGrid,
  Box,
  Blocks,
  Terminal,
  Activity,
  Settings,
  GitFork as Github,
  ArrowUpRight,
  ArrowRight,
  Plus,
  ChevronRight,
  Check,
  Copy,
  GitBranch,
  ShieldCheck,
  Workflow,
  Code2,
  Database,
  FileCode2,
  RefreshCw,
  LoaderCircle,
  Unplug,
  Search,
  Lock,
  ExternalLink,
  LogOut,
  AlertTriangle,
  Network,
  Play,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './ui/button';
type Application = {
  id: string;
  name: string;
  slug: string;
  repositoryOwner: string;
  repositoryName: string;
  defaultBranch: string;
  framework: string | null;
  language: string | null;
  enabled: boolean;
  published: boolean;
  sourceChanged: boolean;
  analyzedCommitSha: string | null;
  _count?: { capabilities: number };
  runs?: { status: string; progress: number; stage: string }[];
};
type Capability = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  status: string;
  policy: string;
  enabled: boolean;
  operationType: string;
  risk: string;
  confidence: number;
  inputSchema: unknown;
  implementation: {
    httpMethod: string;
    route: string;
    supported: boolean;
    warnings: string[];
    services: string[];
  };
  evidence: { file: string; symbol: string; line: number; reason: string; snippet: string }[];
  permissions: string[];
  preconditions: string[];
  sideEffects: string[];
  affectedModels: string[];
};
type Log = {
  id: string;
  createdAt: string;
  capabilityName: string;
  client: string;
  status: string;
  duration: number;
  errorCode: string | null;
  inputSummary: unknown;
  resultSummary: unknown;
};
type AppData = {
  application: Application;
  endpoint: string;
  capabilities: Capability[];
  run: null | {
    status: string;
    stage: string;
    progress: number;
    errorCode: string | null;
    metrics: Record<string, number>;
    index: {
      warnings: string[];
      endpoints: unknown[];
      services: unknown[];
      models: unknown[];
      schemas: unknown[];
    };
    _count: { nodes: number; edges: number };
  };
  environment: null | {
    name: string;
    baseUrl: string;
    issuerUrl: string;
    clientId: string;
    scopes: string;
    status: string;
    credentials: { subject: string; expiresAt: string }[];
  };
  logs: Log[];
  clients: { id: string; name: string; redirectUris: string[] }[];
  confirmations: {
    id: string;
    capabilityId: string;
    input: unknown;
    expiresAt: string;
    approvedAt: string | null;
  }[];
};
type SettingsData = {
  configuration: { github: boolean; gemini: boolean; database: boolean; redis: boolean };
  github: null | { login: string };
  appUrl: string;
};
async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    ...(body
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.replaceAll('_', ' ').toLowerCase() ?? 'Request failed');
  return result;
}
function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
function Empty({
  icon: Icon = Box,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
}) {
  return (
    <div className="metric">
      <span>
        {label}
        <Icon size={16} />
      </span>
      <strong>{value}</strong>
    </div>
  );
}
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Copy"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </Button>
  );
}
function LogTable({ logs }: { logs: Log[] }) {
  return logs.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Capability</th>
            <th>Client</th>
            <th>Result</th>
            <th>Duration</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>
                <code>{log.capabilityName}</code>
                {log.errorCode && <small className="muted block">{log.errorCode}</small>}
              </td>
              <td>{log.client}</td>
              <td>
                <Badge
                  tone={
                    log.status === 'SUCCEEDED' ? 'green' : log.status === 'FAILED' ? 'red' : 'amber'
                  }
                >
                  {log.status.toLowerCase().replaceAll('_', ' ')}
                </Badge>
              </td>
              <td className="mono">{log.duration} ms</td>
              <td className="muted">{new Date(log.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty icon={Activity} title="No executions yet">
      Real capability executions and their outcomes will appear here.
    </Empty>
  );
}
export function Dashboard({ user }: { user: { name: string; email: string } }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const appId = segments[0] === 'apps' ? segments[1] : null;
  const section = appId ? (segments[2] ?? 'overview') : (segments[0] ?? 'overview');
  const [applications, setApplications] = useState<Application[]>([]),
    [settings, setSettings] = useState<SettingsData | null>(null),
    [data, setData] = useState<AppData | null>(null),
    [logs, setLogs] = useState<Log[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [repositories, setRepositories] = useState<
      { id: number; name: string; owner: { login: string } }[] | null
    >(null),
    [selected, setSelected] = useState<string | null>(null),
    [result, setResult] = useState<unknown>(null),
    [query, setQuery] = useState('');
  const refresh = useCallback(async () => {
    const [apps, configuration] = await Promise.all([
      api<Application[]>('/api/applications'),
      api<SettingsData>('/api/settings'),
    ]);
    setApplications(apps);
    setSettings(configuration);
    if (appId) setData(await api<AppData>(`/api/apps/${appId}`));
    else if (section === 'activity') setLogs(await api<Log[]>('/api/activity'));
  }, [appId, section]);
  useEffect(() => {
    setLoading(true);
    setSelected(null);
    setResult(null);
    setData(null);
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (!data?.run || !['QUEUED', 'RUNNING'].includes(data.run.status)) return;
    const timer = setInterval(() => refresh().catch((e) => setError(e.message)), 2500);
    return () => clearInterval(timer);
  }, [data?.run?.status, refresh]);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  const connect = () =>
    act(async () => {
      const result = await api<{ url: string }>('/api/github/start', 'POST');
      window.location.href = result.url;
    });
  const app = data?.application;
  const approved =
    data?.capabilities.filter((c) => ['APPROVED', 'VERIFIED'].includes(c.status) && c.enabled)
      .length ?? 0;
  const navigation: [string, string, LucideIcon][] = [
    ['/', 'Overview', LayoutGrid],
    ['/applications', 'Applications', Box],
    ['/capabilities', 'Capabilities', Blocks],
    ['/agent-playground', 'Agent Playground', Terminal],
    ['/activity', 'Activity', Activity],
    ['/settings', 'Settings', Settings],
  ];
  const appNavigation: [string, string][] = [
    ['overview', 'Overview'],
    ['analysis', 'Analysis'],
    ['capabilities', 'Capabilities'],
    ['connections', 'Connections'],
    ['agent-access', 'Agent Access'],
    ['agent-playground', 'Playground'],
    ['activity', 'Activity'],
  ];
  const cap = data?.capabilities.find((c) => c.id === selected);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <Hexagon size={27} />
          <span>
            hive<span className="brand-dot">.</span>
          </span>
          <Badge>V1</Badge>
        </Link>
        <div className="workspace">
          <span className="workspace-avatar">{user.name[0].toUpperCase()}</span>
          <div>
            <strong>Personal workspace</strong>
            <small>Local development</small>
          </div>
          <span className="status-dot" />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navigation.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              className={
                !appId && ((href === '/' && section === 'overview') || href === pathname)
                  ? 'active'
                  : ''
              }
            >
              <Icon size={17} />
              {label}
              {label === 'Applications' && <span className="nav-count">{applications.length}</span>}
            </Link>
          ))}
        </nav>
        {applications.length > 0 && (
          <>
            <div className="nav-label apps-label">APPLICATIONS</div>
            <nav>
              {applications.map((a) => (
                <Link key={a.id} href={`/apps/${a.id}`} className={appId === a.id ? 'active' : ''}>
                  <span className="app-dot" />
                  {a.name}
                </Link>
              ))}
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="status-dot" />
            <span>Local environment</span>
            <code>V1</code>
          </div>
          <button
            className="profile"
            onClick={() =>
              act(async () => {
                await api('/api/auth/logout', 'POST');
                window.location.href = '/';
              })
            }
          >
            <div className="avatar">{user.name[0].toUpperCase()}</div>
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            {app ? (
              <>
                <Link href="/applications">Applications</Link>
                <ChevronRight size={14} />
                <span>{app.name}</span>
              </>
            ) : (
              <span>{navigation.find(([href]) => href === pathname)?.[1] ?? 'Overview'}</span>
            )}
          </div>
          <span className="topbar-right">
            <span className="status-dot" />
            LOCAL <span className="divider" /> <code>localhost:3000</code>
          </span>
        </header>
        <main className="content">
          {error && (
            <div className="notice error" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button onClick={() => setError('')}>Dismiss</button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <LoaderCircle className="spin" size={22} />
              Loading workspace…
            </div>
          ) : (
            <>
              {!appId && section === 'overview' && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">APPLICATION INTELLIGENCE</span>
                      <h1>Your software, ready for agents.</h1>
                      <p>Discover what your application can do. Control how agents use it.</p>
                    </div>
                    <Button onClick={connect} disabled={busy}>
                      <Github size={17} />
                      Connect GitHub
                    </Button>
                  </div>
                  <div className="metrics">
                    <Metric label="Applications" value={applications.length} icon={Box} />
                    <Metric
                      label="Discovered capabilities"
                      value={applications.reduce((n, a) => n + (a._count?.capabilities ?? 0), 0)}
                      icon={Blocks}
                    />
                    <Metric
                      label="Published interfaces"
                      value={applications.filter((a) => a.published).length}
                      icon={Network}
                    />
                    <Metric
                      label="Analysis engine"
                      value={settings?.configuration.gemini ? 'Configured' : 'Setup needed'}
                      icon={Workflow}
                    />
                  </div>
                  <section className="panel start-panel">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">FROM SOURCE TO ACTION</span>
                        <h2>A new interface for your existing software</h2>
                        <p>Business capabilities, grounded in your application’s own code.</p>
                      </div>
                      <Badge tone="amber">Developer approval required</Badge>
                    </div>
                    <div className="pipeline">
                      {[
                        [Github, 'Connect repository', 'Read-only GitHub App access'],
                        [Code2, 'Understand application', 'Routes, services, data, permissions'],
                        [ShieldCheck, 'Review capabilities', 'Inspect evidence and set policies'],
                        [Terminal, 'Connect any agent', 'One standard MCP interface'],
                      ].map(([Icon, title, description], i) => {
                        const I = Icon as LucideIcon;
                        return (
                          <div className="pipeline-step" key={i}>
                            <span className="step-number">0{i + 1}</span>
                            <I size={23} />
                            <h3>{String(title)}</h3>
                            <p>{String(description)}</p>
                            {i < 3 && <ArrowRight className="pipeline-arrow" size={17} />}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                  <div className="section-heading standalone">
                    <h2>
                      Applications <span className="count">{applications.length}</span>
                    </h2>
                    <Link className="link" href="/applications">
                      View all <ArrowRight size={14} />
                    </Link>
                  </div>
                  {applications.length ? (
                    <AppCards applications={applications} />
                  ) : (
                    <section className="panel">
                      <Empty
                        icon={Box}
                        title="Connect your first application"
                        action={
                          <Button variant="outline" onClick={connect} disabled={busy}>
                            <Github size={16} />
                            Connect GitHub
                            <ArrowUpRight size={15} />
                          </Button>
                        }
                      >
                        Connect a Next.js repository to begin. Hive will analyze the source and
                        surface capabilities for your review.
                      </Empty>
                    </section>
                  )}
                  <div className="bottom-note">
                    <Lock size={14} />
                    Source access, application authorization, and agent access are kept separate.
                  </div>
                </>
              )}
              {!appId && section === 'applications' && (
                <>
                  <Heading
                    title="Applications"
                    description="Your source-connected applications and their agent interfaces."
                    action={
                      <Button onClick={connect} disabled={busy}>
                        <Github size={16} />
                        Connect GitHub
                      </Button>
                    }
                  />
                  {settings?.github && (
                    <section className="panel padded">
                      <div className="section-heading">
                        <div>
                          <h3>GitHub connected as {settings.github.login}</h3>
                          <p>Select a repository installed for your Hive GitHub App.</p>
                        </div>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            act(async () => setRepositories(await api('/api/github/repositories')))
                          }
                        >
                          Choose repository
                        </Button>
                      </div>
                      {repositories && (
                        <form
                          className="form-grid"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = Object.fromEntries(new FormData(event.currentTarget));
                            act(async () => {
                              const app = await api<Application>('/api/applications', 'POST', {
                                repositoryId: Number(form.repositoryId),
                                name: form.name,
                                slug: form.slug,
                              });
                              window.location.href = `/apps/${app.id}`;
                            });
                          }}
                        >
                          <label>
                            Repository
                            <select name="repositoryId" required>
                              {repositories.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.owner.login}/{r.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Application name
                            <input name="name" required placeholder="Your application" />
                          </label>
                          <label>
                            Endpoint slug
                            <input
                              name="slug"
                              required
                              pattern="[a-z][a-z0-9-]{2,59}"
                              placeholder="your-application"
                            />
                          </label>
                          <Button disabled={busy || repositories.length === 0}>
                            Connect application
                          </Button>
                        </form>
                      )}
                    </section>
                  )}
                  {applications.length ? (
                    <AppCards applications={applications} />
                  ) : (
                    <section className="panel">
                      <Empty icon={Github} title="No repositories connected">
                        Install the Hive GitHub App on a selected repository. Repository access
                        stays read-only.
                      </Empty>
                    </section>
                  )}
                </>
              )}
              {!appId && ['capabilities', 'agent-playground'].includes(section) && (
                <>
                  <Heading
                    title={section === 'capabilities' ? 'Capability registry' : 'Agent Playground'}
                    description="Choose an application to access its isolated capability registry."
                  />
                  {applications.length ? (
                    <AppCards applications={applications} suffix={section} />
                  ) : (
                    <section className="panel">
                      <Empty
                        icon={section === 'capabilities' ? Blocks : Terminal}
                        title="An application comes first"
                        action={
                          <Button asChild variant="outline">
                            <Link href="/applications">
                              Connect application
                              <ArrowRight size={16} />
                            </Link>
                          </Button>
                        }
                      >
                        Capabilities are discovered from source code and reviewed before
                        publication.
                      </Empty>
                    </section>
                  )}
                </>
              )}
              {!appId && section === 'activity' && (
                <>
                  <Heading
                    title="Activity"
                    description="Execution records across your applications. Customer field values are omitted from audit logs."
                  />
                  <section className="panel">
                    <LogTable logs={logs} />
                  </section>
                </>
              )}
              {!appId && section === 'settings' && (
                <>
                  <Heading
                    title="Workspace settings"
                    description="Local infrastructure and external configuration."
                  />
                  <section className="panel">
                    <div className="panel-title">Services & providers</div>
                    {settings &&
                      Object.entries(settings.configuration).map(([key, value]) => (
                        <div className="setting-row" key={key}>
                          <span>
                            <strong>
                              {
                                (
                                  {
                                    github: 'GitHub App',
                                    gemini: 'Gemini semantic analysis',
                                    database: 'PostgreSQL',
                                    redis: 'Redis job queue',
                                  } as Record<string, string>
                                )[key]
                              }
                            </strong>
                            <small>
                              {key === 'github'
                                ? 'Read-only source access with installation tokens'
                                : key === 'gemini'
                                  ? 'Server-side inference from bounded source evidence'
                                  : 'Local infrastructure'}
                            </small>
                          </span>
                          <Badge tone={value ? 'green' : 'amber'}>
                            {value ? 'Configured' : 'Setup required'}
                          </Badge>
                        </div>
                      ))}
                  </section>
                  <section className="panel padded">
                    <h3>External setup</h3>
                    <p>
                      Register a GitHub App and add its credentials to the project’s{' '}
                      <code>.env</code>. Add a Gemini API key for semantic analysis.
                    </p>
                    <div className="code-row">
                      <code>docs/CONFIGURATION.md</code>
                    </div>
                    <p>
                      OAuth callback <code>{settings?.appUrl}/api/github/callback</code>
                    </p>
                    <p>
                      Webhook <code>{settings?.appUrl}/api/github/webhook</code>
                    </p>
                    <p className="muted">
                      Secrets remain server-side. Configuration status never returns credential
                      values.
                    </p>
                  </section>
                </>
              )}
              {appId && app && data && (
                <>
                  <Heading
                    title={app.name}
                    description={`${app.repositoryOwner}/${app.repositoryName}`}
                    action={
                      <>
                        <Badge tone={app.published ? 'green' : 'neutral'}>
                          {app.published ? 'Published' : 'Not published'}
                        </Badge>
                        <Button
                          variant="outline"
                          disabled={busy || ['RUNNING', 'QUEUED'].includes(data.run?.status ?? '')}
                          onClick={() => act(() => api(`/api/apps/${app.id}/analyze`, 'POST'))}
                        >
                          <RefreshCw size={15} />
                          Analyze application
                        </Button>
                      </>
                    }
                  />
                  <div className="app-tabs">
                    {appNavigation.map(([key, label]) => (
                      <Link
                        key={key}
                        className={section === key ? 'active' : ''}
                        href={`/apps/${app.id}/${key === 'overview' ? '' : key}`}
                      >
                        {label}
                      </Link>
                    ))}
                  </div>
                  {app.sourceChanged && (
                    <div className="notice">
                      <AlertTriangle size={16} />
                      Source changed. Reanalysis and developer review are required before
                      publication.
                    </div>
                  )}
                  {section === 'overview' && (
                    <>
                      <div className="metrics">
                        <Metric
                          label="Framework"
                          value={app.framework ?? 'Not analyzed'}
                          icon={Code2}
                        />
                        <Metric
                          label="Capabilities"
                          value={data.capabilities.length}
                          icon={Blocks}
                        />
                        <Metric label="Approved" value={approved} icon={ShieldCheck} />
                        <Metric
                          label="Verified"
                          value={data.capabilities.filter((c) => c.status === 'VERIFIED').length}
                          icon={Check}
                        />
                      </div>
                      <div className="two-columns">
                        <section className="panel padded">
                          <h3>Source connection</h3>
                          <div className="detail-row">
                            <span>Repository</span>
                            <code>
                              {app.repositoryOwner}/{app.repositoryName}
                            </code>
                          </div>
                          <div className="detail-row">
                            <span>Branch</span>
                            <code>
                              <GitBranch size={13} />
                              {app.defaultBranch}
                            </code>
                          </div>
                          <div className="detail-row">
                            <span>Analyzed commit</span>
                            <code>{app.analyzedCommitSha?.slice(0, 12) ?? 'Not analyzed'}</code>
                          </div>
                          <div className="detail-row">
                            <span>Language</span>
                            <span>{app.language ?? 'Not analyzed'}</span>
                          </div>
                        </section>
                        <section className="panel padded">
                          <h3>Agent interface</h3>
                          <p>One application. One registry. Any compatible MCP client.</p>
                          <div className="code-row">
                            <code>{data.endpoint}</code>
                            <CopyButton value={data.endpoint} />
                          </div>
                          <Link className="link" href={`/apps/${app.id}/agent-access`}>
                            Manage agent access
                            <ArrowRight size={15} />
                          </Link>
                        </section>
                      </div>
                      <section className="panel">
                        <div className="panel-title">Recent activity</div>
                        <LogTable logs={data.logs.slice(0, 5)} />
                      </section>
                    </>
                  )}
                  {section === 'analysis' && (
                    <>
                      {data.run ? (
                        <>
                          <section className="panel padded">
                            <div className="section-heading">
                              <div>
                                <h3>{data.run.stage}</h3>
                                <p>
                                  {data.run.errorCode ??
                                    'Progress and counts are reported by the background worker.'}
                                </p>
                              </div>
                              <Badge
                                tone={
                                  data.run.status === 'COMPLETED'
                                    ? 'green'
                                    : data.run.status === 'FAILED'
                                      ? 'red'
                                      : 'amber'
                                }
                              >
                                {data.run.status}
                              </Badge>
                            </div>
                            <div className="progress">
                              <span style={{ width: `${data.run.progress}%` }} />
                            </div>
                            <div className="metrics compact">
                              {Object.entries(data.run.metrics).map(([name, value]) => (
                                <Metric key={name} label={name} value={value} icon={FileCode2} />
                              ))}
                            </div>
                          </section>
                          {data.run.index && (
                            <>
                              <section className="panel padded">
                                <h3>Application Capability Graph</h3>
                                <p>
                                  {data.run._count.nodes} evidence nodes · {data.run._count.edges}{' '}
                                  relationships
                                </p>
                                <p>
                                  Routes → handlers → schemas & permissions → services → data models
                                </p>
                                <Button
                                  variant="outline"
                                  onClick={() =>
                                    act(async () =>
                                      setResult(await api(`/api/apps/${app.id}/graph`)),
                                    )
                                  }
                                >
                                  <Network size={16} />
                                  Inspect graph
                                </Button>
                                {result !== null && <Json value={result} />}
                              </section>
                              {['endpoints', 'services', 'models', 'schemas', 'warnings'].map(
                                (key) => (
                                  <details className="panel details" key={key}>
                                    <summary>
                                      {key}
                                      <span>
                                        {(
                                          data.run!.index[
                                            key as keyof typeof data.run.index
                                          ] as unknown[]
                                        )?.length ?? 0}
                                      </span>
                                    </summary>
                                    <Json
                                      value={data.run!.index[key as keyof typeof data.run.index]}
                                    />
                                  </details>
                                ),
                              )}
                            </>
                          )}
                        </>
                      ) : (
                        <section className="panel">
                          <Empty
                            icon={Code2}
                            title="Ready for source analysis"
                            action={
                              <Button
                                onClick={() =>
                                  act(() => api(`/api/apps/${app.id}/analyze`, 'POST'))
                                }
                                disabled={busy}
                              >
                                <Play size={16} />
                                Analyze application
                              </Button>
                            }
                          >
                            Hive will index this repository, build an evidence graph, and ask Gemini
                            to infer business capabilities.
                          </Empty>
                        </section>
                      )}
                    </>
                  )}
                  {section === 'capabilities' && (
                    <>
                      {cap ? (
                        <CapabilityDetail
                          cap={cap}
                          busy={busy}
                          onClose={() => setSelected(null)}
                          onUpdate={(changes) =>
                            act(() =>
                              api(`/api/apps/${app.id}/capabilities/${cap.id}`, 'PATCH', changes),
                            )
                          }
                        />
                      ) : (
                        <>
                          <div className="toolbar">
                            <div className="search">
                              <Search size={16} />
                              <input
                                placeholder="Search capabilities…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                              />
                            </div>
                            <Badge>{data.capabilities.length} discovered</Badge>
                          </div>
                          <section className="panel">
                            {data.capabilities.length ? (
                              <div className="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Capability</th>
                                      <th>Implementation</th>
                                      <th>Risk</th>
                                      <th>Confidence</th>
                                      <th>Status</th>
                                      <th />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {data.capabilities
                                      .filter((c) =>
                                        `${c.name} ${c.description}`
                                          .toLowerCase()
                                          .includes(query.toLowerCase()),
                                      )
                                      .map((c) => (
                                        <tr
                                          className="clickable"
                                          key={c.id}
                                          onClick={() => setSelected(c.id)}
                                        >
                                          <td>
                                            <button className="table-link">{c.displayName}</button>
                                            <small className="muted block mono">{c.name}</small>
                                          </td>
                                          <td>
                                            <Badge>{c.implementation.httpMethod}</Badge>
                                            <code className="route-code">
                                              {c.implementation.route}
                                            </code>
                                          </td>
                                          <td>
                                            <Badge
                                              tone={
                                                ['high', 'critical'].includes(c.risk)
                                                  ? 'amber'
                                                  : 'neutral'
                                              }
                                            >
                                              {c.risk}
                                            </Badge>
                                          </td>
                                          <td className="mono">
                                            {Math.round(c.confidence * 100)}%
                                          </td>
                                          <td>
                                            <Badge
                                              tone={
                                                ['APPROVED', 'VERIFIED'].includes(c.status)
                                                  ? 'green'
                                                  : 'neutral'
                                              }
                                            >
                                              {c.status.toLowerCase().replaceAll('_', ' ')}
                                            </Badge>
                                          </td>
                                          <td>
                                            <ChevronRight size={16} />
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <Empty icon={Blocks} title="No capabilities inferred yet">
                                Run application analysis to discover business operations from the
                                repository.
                              </Empty>
                            )}
                          </section>
                        </>
                      )}
                    </>
                  )}
                  {section === 'connections' && (
                    <>
                      <section className="panel padded">
                        <h3>Application environment</h3>
                        <p>
                          Connect the running application separately from its repository. Hive
                          executes requests as the authorized application user.
                        </p>
                        <form
                          key={data.environment?.baseUrl ?? 'new'}
                          className="form-grid"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const values = Object.fromEntries(new FormData(event.currentTarget));
                            act(() => api(`/api/apps/${app.id}/environment`, 'POST', values));
                          }}
                        >
                          <label>
                            Environment name
                            <input
                              name="name"
                              defaultValue={data.environment?.name ?? 'Local'}
                              required
                            />
                          </label>
                          <label>
                            Application base URL
                            <input
                              name="baseUrl"
                              type="url"
                              defaultValue={data.environment?.baseUrl ?? 'http://localhost:3001'}
                              required
                            />
                          </label>
                          <label>
                            OAuth issuer origin
                            <input
                              name="issuerUrl"
                              type="url"
                              defaultValue={data.environment?.issuerUrl ?? 'http://localhost:3001'}
                              required
                            />
                          </label>
                          <label>
                            OAuth client ID
                            <input
                              name="clientId"
                              defaultValue={data.environment?.clientId ?? ''}
                              required
                            />
                          </label>
                          <label>
                            OAuth client secret (if required)
                            <input name="clientSecret" type="password" autoComplete="off" />
                          </label>
                          <label>
                            Scopes
                            <input
                              name="scopes"
                              defaultValue={data.environment?.scopes ?? 'openid profile'}
                              required
                            />
                          </label>
                          <p className="muted form-wide">
                            Saving the environment clears prior application authorization. Issuer
                            must publish OpenID discovery with userinfo and support PKCE S256.
                          </p>
                          <Button disabled={busy}>Save environment</Button>
                        </form>
                      </section>
                      <section className="panel padded">
                        <div className="section-heading">
                          <div>
                            <h3>Application user authorization</h3>
                            <p>
                              {data.environment?.credentials[0]
                                ? `Connected subject: ${data.environment.credentials[0].subject}`
                                : 'No application user connected.'}
                            </p>
                          </div>
                          {data.environment?.credentials[0] && (
                            <Badge tone="green">Authorized</Badge>
                          )}
                        </div>
                        <div className="button-row">
                          <Button
                            disabled={busy || !data.environment}
                            onClick={() =>
                              act(async () => {
                                const result = await api<{ url: string }>(
                                  `/api/apps/${app.id}/authorize`,
                                  'POST',
                                );
                                window.location.href = result.url;
                              })
                            }
                          >
                            <Lock size={16} />
                            Authorize application user
                          </Button>
                          {data.environment?.credentials.length !== 0 && data.environment && (
                            <Button
                              variant="outline"
                              onClick={() =>
                                act(() => api(`/api/apps/${app.id}/disconnect`, 'POST'))
                              }
                            >
                              <Unplug size={16} />
                              Disconnect
                            </Button>
                          )}
                        </div>
                      </section>
                    </>
                  )}
                  {section === 'agent-access' && (
                    <>
                      <section className="panel padded endpoint-panel">
                        <span className="eyebrow">STANDARD MCP · STREAMABLE HTTP</span>
                        <h2>Your application’s agent interface</h2>
                        <p>Connect this endpoint to any compatible MCP client.</p>
                        <div className="code-row">
                          <code>{data.endpoint}</code>
                          <CopyButton value={data.endpoint} />
                        </div>
                        <div className="section-heading">
                          <div className="button-row">
                            <Badge tone={app.published ? 'green' : 'neutral'}>
                              {app.published ? 'Published' : 'Unpublished'}
                            </Badge>
                            <Badge>
                              <Lock size={12} />
                              OAuth + PKCE
                            </Badge>
                            <span className="muted">{approved} approved capabilities</span>
                          </div>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              act(() =>
                                api(`/api/apps/${app.id}/publish`, 'POST', {
                                  published: !app.published,
                                }),
                              )
                            }
                          >
                            {app.published ? 'Unpublish' : 'Publish interface'}
                          </Button>
                        </div>
                      </section>
                      <section className="panel padded">
                        <h3>Registered clients</h3>
                        <p>
                          Register an exact redirect URI from your MCP client. Hive uses public
                          clients with PKCE.
                        </p>
                        {data.clients.map((client) => (
                          <div className="setting-row" key={client.id}>
                            <span>
                              <strong>{client.name}</strong>
                              <small className="mono">{client.id}</small>
                              <small>{client.redirectUris.join(', ')}</small>
                            </span>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                act(() => api(`/api/apps/${app.id}/clients/${client.id}`, 'DELETE'))
                              }
                            >
                              Revoke
                            </Button>
                          </div>
                        ))}
                        <form
                          className="form-grid"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const values = Object.fromEntries(new FormData(event.currentTarget));
                            act(() =>
                              api(`/api/apps/${app.id}/clients`, 'POST', {
                                name: values.name,
                                redirectUris: [values.redirectUri],
                              }),
                            );
                          }}
                        >
                          <label>
                            Client name
                            <input name="name" placeholder="My MCP client" required />
                          </label>
                          <label>
                            Exact redirect URI
                            <input
                              name="redirectUri"
                              type="url"
                              placeholder="http://localhost:8080/callback"
                              required
                            />
                          </label>
                          <Button disabled={busy} variant="outline">
                            <Plus size={15} />
                            Register client
                          </Button>
                        </form>
                      </section>
                      <section className="panel">
                        <div className="panel-title">Compatibility testing</div>
                        {['ChatGPT', 'Claude', 'Gemini Spark'].map((client) => (
                          <div className="setting-row" key={client}>
                            <span>
                              <strong>{client}</strong>
                              <small>Same endpoint · same capability registry</small>
                            </span>
                            <Badge>Not tested</Badge>
                          </div>
                        ))}
                      </section>
                    </>
                  )}
                  {section === 'agent-playground' && (
                    <>
                      <div className="notice">
                        <ShieldCheck size={17} />
                        This playground uses the actual MCP endpoint. Write actions require approval
                        below.
                      </div>
                      {data.confirmations.map((confirmation) => (
                        <section className="panel padded confirmation" key={confirmation.id}>
                          <div className="section-heading">
                            <h3>
                              {confirmation.approvedAt
                                ? 'Approved — ready to retry'
                                : 'Review proposed operation'}
                            </h3>
                            <Badge tone="amber">
                              One use · expires{' '}
                              {new Date(confirmation.expiresAt).toLocaleTimeString()}
                            </Badge>
                          </div>
                          <p>
                            <code>
                              {
                                data.capabilities.find((c) => c.id === confirmation.capabilityId)
                                  ?.name
                              }
                            </code>
                          </p>
                          <Json value={confirmation.input} />
                          <div className="code-row">
                            <code>hive_confirmation_id: {confirmation.id}</code>
                            <CopyButton value={confirmation.id} />
                          </div>
                          <Button
                            disabled={busy || !!confirmation.approvedAt}
                            onClick={() =>
                              act(() =>
                                api(`/api/apps/${app.id}/confirmations/${confirmation.id}`, 'POST'),
                              )
                            }
                          >
                            {confirmation.approvedAt ? 'Approved' : 'Approve this exact request'}
                          </Button>
                        </section>
                      ))}
                      <div className="two-columns">
                        <section className="panel padded">
                          <h3>Test a capability through MCP</h3>
                          <p>Use the input schema shown in the capability detail.</p>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              const values = Object.fromEntries(new FormData(event.currentTarget));
                              act(async () =>
                                setResult(
                                  await api(`/api/apps/${app.id}/test`, 'POST', {
                                    name: values.name,
                                    arguments: JSON.parse(String(values.arguments)),
                                  }),
                                ),
                              );
                            }}
                          >
                            <label>
                              Capability
                              <select name="name" required>
                                {data.capabilities
                                  .filter(
                                    (c) => c.enabled && ['APPROVED', 'VERIFIED'].includes(c.status),
                                  )
                                  .map((c) => (
                                    <option key={c.id} value={c.name}>
                                      {c.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <label>
                              Arguments (JSON)
                              <textarea
                                name="arguments"
                                rows={8}
                                defaultValue={'{\n  "path": {},\n  "query": {},\n  "body": {}\n}'}
                                required
                              />
                            </label>
                            <Button disabled={busy || !app.published}>
                              <Play size={15} />
                              Execute via MCP
                            </Button>
                          </form>
                        </section>
                        <section className="panel padded">
                          <h3>Internal test agent</h3>
                          <p>Gemini chooses from the approved tools discovered over MCP.</p>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              const form = new FormData(event.currentTarget);
                              act(async () =>
                                setResult(
                                  await api(`/api/apps/${app.id}/playground`, 'POST', {
                                    prompt: form.get('prompt'),
                                  }),
                                ),
                              );
                            }}
                          >
                            <label>
                              Prompt
                              <textarea
                                name="prompt"
                                placeholder="Ask the agent to use a capability in this application…"
                                required
                                rows={10}
                              />
                            </label>
                            <Button disabled={busy || !app.published}>
                              <Terminal size={15} />
                              Run test agent
                            </Button>
                          </form>
                        </section>
                      </div>
                      {busy && (
                        <div className="loading">
                          <LoaderCircle className="spin" size={18} />
                          Waiting for the real MCP response…
                        </div>
                      )}
                      {result !== null && (
                        <section className="panel padded">
                          <h3>MCP result & tool trace</h3>
                          <Json value={result} />
                        </section>
                      )}
                    </>
                  )}
                  {section === 'activity' && (
                    <section className="panel">
                      <LogTable logs={data.logs} />
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </main>
        <footer className="main-footer">
          <span>HIVE / APPLICATION INTELLIGENCE</span>
          <span>Built around your business logic.</span>
        </footer>
      </div>
    </div>
  );
}
function Heading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="button-row">{action}</div>
    </div>
  );
}
function AppCards({ applications, suffix = '' }: { applications: Application[]; suffix?: string }) {
  return (
    <div className="app-grid">
      {applications.map((app) => (
        <Link key={app.id} href={`/apps/${app.id}/${suffix}`} className="panel app-card">
          <div className="section-heading">
            <div className="app-icon">
              <Box size={22} />
            </div>
            <ArrowUpRight size={18} />
          </div>
          <h3>{app.name}</h3>
          <p>
            <Github size={14} />
            {app.repositoryOwner}/{app.repositoryName}
          </p>
          <div className="app-card-bottom">
            <Badge tone={app.published ? 'green' : 'neutral'}>
              {app.published ? 'Published' : 'Not published'}
            </Badge>
            <span>{app._count?.capabilities ?? 0} capabilities</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
function CapabilityDetail({
  cap,
  busy,
  onClose,
  onUpdate,
}: {
  cap: Capability;
  busy: boolean;
  onClose: () => void;
  onUpdate: (input: unknown) => void;
}) {
  return (
    <>
      <button className="text-button back" onClick={onClose}>
        ← All capabilities
      </button>
      <section className="panel padded">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{cap.category}</span>
            <h2>{cap.displayName}</h2>
            <code>{cap.name}</code>
          </div>
          <div className="button-row">
            <Badge tone="amber">{cap.risk} risk</Badge>
            <Badge>{Math.round(cap.confidence * 100)}% confidence</Badge>
          </div>
        </div>
        <p>{cap.description}</p>
        <div className="code-row">
          <Badge>{cap.implementation.httpMethod}</Badge>
          <code>{cap.implementation.route}</code>
        </div>
        {!cap.implementation.supported && (
          <div className="notice error">
            Approval blocked: {cap.implementation.warnings.join(' ')}
          </div>
        )}
        <div className="button-row">
          <Button
            disabled={busy || !cap.implementation.supported}
            onClick={() => onUpdate({ status: 'APPROVED' })}
          >
            <Check size={15} />
            Approve
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onUpdate({ status: 'REJECTED' })}
          >
            Reject
          </Button>
          <label className="inline-label">
            Policy
            <select value={cap.policy} onChange={(e) => onUpdate({ policy: e.target.value })}>
              <option value="automatic" disabled={cap.operationType !== 'READ'}>
                Automatic
              </option>
              <option value="confirmation_required">Confirmation required</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={cap.enabled}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
            />
            Agent access enabled
          </label>
        </div>
      </section>
      <div className="two-columns">
        <section className="panel padded">
          <h3>Input schema</h3>
          <Json value={cap.inputSchema} />
        </section>
        <section className="panel padded">
          <h3>Business context</h3>
          {[
            ['Permissions', cap.permissions],
            ['Preconditions', cap.preconditions],
            ['Side effects', cap.sideEffects],
            ['Affected models', cap.affectedModels],
          ].map(([label, values]) => (
            <div key={String(label)} className="context-group">
              <h4>{String(label)}</h4>
              {(values as string[]).length ? (
                <ul>
                  {(values as string[]).map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No evidence extracted</p>
              )}
            </div>
          ))}
        </section>
      </div>
      <section className="panel padded">
        <h3>Source evidence</h3>
        <p>Deterministic source references underlying this capability.</p>
        {cap.evidence.map((e, i) => (
          <details className="evidence" key={i} open={i === 0}>
            <summary>
              <FileCode2 size={16} />
              <code>
                {e.file}:{e.line}
              </code>
              <Badge>{e.symbol}</Badge>
            </summary>
            <p>{e.reason}</p>
            <pre>{e.snippet}</pre>
          </details>
        ))}
      </section>
      <details className="panel padded">
        <summary>Edit display metadata</summary>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            onUpdate(Object.fromEntries(new FormData(e.currentTarget)));
          }}
        >
          <label>
            Display name
            <input name="displayName" defaultValue={cap.displayName} required />
          </label>
          <label>
            Description
            <textarea name="description" defaultValue={cap.description} required />
          </label>
          <Button disabled={busy}>Save metadata</Button>
        </form>
      </details>
    </>
  );
}

// Canonical ACP message renderer. React owns incomplete text and completed rich
// output is isolated behind bounded Markdown and a visible plain-text fallback.
// Remote images and raw HTML never enter the Agent transcript.
import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useState,
  type ErrorInfo,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { Icon } from "../../components/Icon";
import { useTheme } from "../theme";
import {
  highlightAgentCode,
  type AgentSyntaxLine,
} from "../agentSyntax";
import { Button } from "./Button";
import RenderRecoveryBoundary from "./RenderRecoveryBoundary";

const MAX_HIGHLIGHT_CHARS = 48_000;
const MAX_MERMAID_CHARS = 24_000;
const MAX_RICH_TEXT_CHARS = 64 * 1024;
const MAX_RICH_TEXT_LINES = 1_000;
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

export type AgentRichTextLabels = {
  copied: string;
  copyCode: string;
  diagram: string;
  diagramError: string;
  diagramLoading: string;
  diagramSource: string;
  imageOmitted: string;
  openLink: string;
  plainTextFallback: string;
};

export function AgentRichText({
  labels,
  onError,
  onOpenLink,
  text,
}: {
  labels: AgentRichTextLabels;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onOpenLink?: (href: string) => void;
  text: string;
}) {
  if (!canRenderAgentRichText([text])) {
    return <AgentPlainText notice={labels.plainTextFallback} text={text} />;
  }

  return (
    <RenderRecoveryBoundary
      fallback={() => (
        <AgentPlainText notice={labels.plainTextFallback} text={text} />
      )}
      onError={onError}
      resetKeys={[text]}
    >
      <AgentRichTextContent
        labels={labels}
        onOpenLink={onOpenLink}
        text={text}
      />
    </RenderRecoveryBoundary>
  );
}

function AgentRichTextContent({
  labels,
  onOpenLink,
  text,
}: {
  labels: AgentRichTextLabels;
  onOpenLink?: (href: string) => void;
  text: string;
}) {
  const {
    copied,
    copyCode,
    diagram,
    diagramError,
    diagramLoading,
    diagramSource,
    imageOmitted,
    openLink,
    plainTextFallback,
  } = labels;
  const components = useMemo(
    () =>
      createMarkdownComponents(
        {
          copied,
          copyCode,
          diagram,
          diagramError,
          diagramLoading,
          diagramSource,
          imageOmitted,
          openLink,
          plainTextFallback,
        },
        false,
        onOpenLink,
      ),
    [
      copied,
      copyCode,
      diagram,
      diagramError,
      diagramLoading,
      diagramSource,
      imageOmitted,
      onOpenLink,
      openLink,
      plainTextFallback,
    ],
  );

  return (
    <div className="tw:grid tw:max-w-full tw:min-w-0 tw:gap-3 tw:break-words tw:text-sm tw:leading-body tw:text-foreground">
      <ReactMarkdown
        components={components}
        rehypePlugins={REHYPE_PLUGINS}
        remarkPlugins={REMARK_PLUGINS}
        skipHtml
        urlTransform={safeAgentUrl}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** React-owned escaped renderer for an incomplete ACP response. */
export function AgentStreamingText({
  chunks,
}: {
  chunks: string[];
  revision: number;
}) {
  return <AgentPlainText text={chunks.join("")} />;
}

export function AgentPlainText({
  notice,
  text,
}: {
  notice?: string;
  text: string;
}) {
  return (
    <div className="tw:grid tw:max-w-full tw:min-w-0 tw:gap-3 tw:break-words tw:text-sm tw:leading-body tw:text-foreground">
      <p className="tw:m-0 tw:min-w-0 tw:whitespace-pre-wrap">{text}</p>
      {notice ? (
        <small className="tw:text-xs tw:leading-body tw:text-muted-foreground" role="status">
          {notice}
        </small>
      ) : null}
    </div>
  );
}

export function canRenderAgentRichText(chunks: readonly string[]) {
  let characters = 0;
  let lines = 1;
  for (const chunk of chunks) {
    characters += chunk.length;
    if (characters > MAX_RICH_TEXT_CHARS) return false;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk.charCodeAt(index) === 10) {
        lines += 1;
        if (lines > MAX_RICH_TEXT_LINES) return false;
      }
    }
  }
  return true;
}

function createMarkdownComponents(
  labels: AgentRichTextLabels,
  streaming: boolean,
  onOpenLink?: (href: string) => void,
): Components {
  return {
    a: ({ children, href }) => (
      <AgentLink
        href={href}
        label={labels.openLink}
        onOpenLink={onOpenLink}
      >
        {children}
      </AgentLink>
    ),
    blockquote: ({ children }) => (
      <blockquote className="tw:m-0 tw:border-l-2 tw:border-border-strong tw:pl-3 tw:text-muted-foreground">
        {children}
      </blockquote>
    ),
    code: ({ children, className }) => {
      const raw = String(children);
      const language = fenceLanguage(className);
      const block = Boolean(language) || raw.includes("\n");
      if (!block) {
        return (
          <code className="tw:rounded-xs tw:bg-muted tw:px-1 tw:py-px tw:font-mono tw:text-xs tw:text-foreground">
            {children}
          </code>
        );
      }

      const code = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
      if (language === "mermaid") {
        return (
          <AgentMermaidBlock
            code={code}
            labels={labels}
            streaming={streaming}
          />
        );
      }
      return (
        <AgentCodeBlock
          code={code}
          copyLabel={labels.copyCode}
          copiedLabel={labels.copied}
          highlight={!streaming}
          language={language}
        />
      );
    },
    del: ({ children }) => (
      <del className="tw:text-muted-foreground">{children}</del>
    ),
    em: ({ children }) => <em className="tw:italic">{children}</em>,
    h1: ({ children }) => (
      <h1 className="tw:m-0 tw:pt-1 tw:text-heading tw:font-semibold tw:leading-tight">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="tw:m-0 tw:pt-1 tw:text-title tw:font-semibold tw:leading-tight">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="tw:m-0 tw:pt-1 tw:text-sm tw:font-semibold tw:leading-tight">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="tw:m-0 tw:text-sm tw:font-semibold">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="tw:m-0 tw:text-xs tw:font-semibold">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="tw:m-0 tw:text-xs tw:font-medium tw:text-muted-foreground">
        {children}
      </h6>
    ),
    hr: () => <hr className="tw:m-0 tw:border-0 tw:border-t tw:border-border-subtle" />,
    img: ({ alt }) => (
      <span className="tw:text-xs tw:text-muted-foreground">
        {alt ? `${labels.imageOmitted}: ${alt}` : labels.imageOmitted}
      </span>
    ),
    input: ({ checked, type }) =>
      type === "checkbox" ? (
        <input
          checked={checked}
          className="tw:mr-2 tw:size-3 tw:accent-primary"
          disabled
          readOnly
          type="checkbox"
        />
      ) : null,
    li: ({ children }) => <li className="tw:min-w-0 tw:pl-0.5">{children}</li>,
    ol: ({ children }) => (
      <ol className="tw:m-0 tw:grid tw:min-w-0 tw:list-decimal tw:gap-1 tw:pl-5">
        {children}
      </ol>
    ),
    p: ({ children }) => <p className="tw:m-0 tw:min-w-0">{children}</p>,
    pre: ({ children }) => <>{children}</>,
    strong: ({ children }) => (
      <strong className="tw:font-semibold">{children}</strong>
    ),
    table: ({ children }) => (
      <div className="tw:max-w-full tw:min-w-0 tw:overflow-auto tw:rounded-sm tw:border tw:border-border-subtle">
        <table className="tw:w-full tw:min-w-max tw:border-collapse tw:text-left tw:text-xs">
          {children}
        </table>
      </div>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    td: ({ children }) => (
      <td className="tw:max-w-80 tw:border-t tw:border-r tw:border-border-subtle tw:px-2 tw:py-1.5 tw:align-top tw:last:border-r-0">
        {children}
      </td>
    ),
    th: ({ children }) => (
      <th className="tw:max-w-80 tw:border-r tw:border-border-subtle tw:bg-muted tw:px-2 tw:py-1.5 tw:font-semibold tw:last:border-r-0">
        {children}
      </th>
    ),
    thead: ({ children }) => <thead>{children}</thead>,
    tr: ({ children }) => <tr>{children}</tr>,
    ul: ({ children }) => (
      <ul className="tw:m-0 tw:grid tw:min-w-0 tw:list-disc tw:gap-1 tw:pl-5">
        {children}
      </ul>
    ),
  };
}

function AgentLink({
  children,
  href,
  label,
  onOpenLink,
}: {
  children: ReactNode;
  href?: string;
  label: string;
  onOpenLink?: (href: string) => void;
}) {
  if (!href || !isExternalAgentUrl(href)) {
    return <span className="tw:text-muted-foreground">{children}</span>;
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenLink) return;
    event.preventDefault();
    onOpenLink(href);
  };
  return (
    <a
      className="tw:inline-flex tw:max-w-full tw:items-baseline tw:gap-1 tw:break-all tw:text-info tw:underline tw:decoration-transparent tw:underline-offset-2 tw:hover:decoration-current"
      href={href}
      onClick={handleClick}
      rel="noreferrer noopener"
      target="_blank"
      title={label}
    >
      <span>{children}</span>
      <Icon className="tw:inline tw:shrink-0 tw:text-[length:var(--ds-icon-sm)]" name="externalLink" />
    </a>
  );
}

function AgentCodeBlock({
  code,
  copiedLabel,
  copyLabel,
  highlight,
  language,
}: {
  code: string;
  copiedLabel: string;
  copyLabel: string;
  highlight: boolean;
  language: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [lines, setLines] = useState<AgentSyntaxLine[] | null>(null);

  useEffect(() => {
    if (!highlight || !language || code.length > MAX_HIGHLIGHT_CHARS) {
      setLines(null);
      return;
    }
    let current = true;
    setLines(null);
    void highlightAgentCode(code, language)
      .then((nextLines) => {
        if (current) setLines(nextLines);
      })
      .catch(() => {
        if (current) setLines(null);
      });
    return () => {
      current = false;
    };
  }, [code, highlight, language]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="tw:max-w-full tw:min-w-0 tw:overflow-hidden tw:rounded-sm tw:border tw:border-border-subtle tw:bg-muted">
      <div className="tw:flex tw:min-h-control-sm tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:px-2">
        <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:font-mono tw:text-2xs tw:text-muted-foreground">
          {language ?? "text"}
        </span>
        <Button
          aria-label={copied ? copiedLabel : copyLabel}
          iconOnly
          onClick={() => void copy()}
          size="xs"
          title={copied ? copiedLabel : copyLabel}
          variant="ghost"
        >
          <Icon name={copied ? "check" : "copy"} />
        </Button>
        <span aria-live="polite" className="tw:sr-only">
          {copied ? copiedLabel : ""}
        </span>
      </div>
      <pre className="tw:m-0 tw:max-h-96 tw:max-w-full tw:overflow-auto tw:p-3 tw:font-mono tw:text-xs tw:leading-body tw:whitespace-pre tw:[tab-size:2]">
        <code className="tw:block tw:min-w-max">
          {lines ? <HighlightedCode lines={lines} /> : code}
        </code>
      </pre>
    </section>
  );
}

function HighlightedCode({ lines }: { lines: AgentSyntaxLine[] }) {
  return lines.map((line, lineIndex) => (
    <Fragment key={lineIndex}>
      {line.map((token, tokenIndex) => (
        <span key={`${lineIndex}:${tokenIndex}`} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
      {lineIndex < lines.length - 1 ? "\n" : null}
    </Fragment>
  ));
}

type DiagramState =
  | { status: "loading" }
  | { status: "ready"; sourceDocument: string }
  | { status: "error" };

function AgentMermaidBlock({
  code,
  labels,
  streaming,
}: {
  code: string;
  labels: AgentRichTextLabels;
  streaming: boolean;
}) {
  const { resolved: colorScheme } = useTheme();
  const reactId = useId();
  const diagramId = useMemo(
    () => `dopedb-agent-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [reactId],
  );
  const [state, setState] = useState<DiagramState>({ status: "loading" });

  useEffect(() => {
    if (streaming) return;
    if (code.length > MAX_MERMAID_CHARS) {
      setState({ status: "error" });
      return;
    }
    let current = true;
    setState({ status: "loading" });
    void renderMermaid(diagramId, code)
      .then((sourceDocument) => {
        if (current) setState({ status: "ready", sourceDocument });
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [code, diagramId, streaming, colorScheme]);

  if (streaming) {
    return (
      <AgentCodeBlock
        code={code}
        copiedLabel={labels.copied}
        copyLabel={labels.copyCode}
        highlight={false}
        language="mermaid"
      />
    );
  }

  return (
    <section className="tw:grid tw:max-w-full tw:min-w-0 tw:gap-2 tw:overflow-hidden tw:rounded-sm tw:border tw:border-border-subtle tw:bg-muted tw:p-2">
      <div className="tw:flex tw:min-h-control-sm tw:items-center tw:gap-2 tw:text-xs tw:text-muted-foreground">
        <Icon name="chart" />
        <span>{labels.diagram}</span>
      </div>
      {state.status === "loading" ? (
        <div className="tw:flex tw:h-32 tw:items-center tw:justify-center tw:text-xs tw:text-muted-foreground">
          {labels.diagramLoading}
        </div>
      ) : state.status === "ready" ? (
        <iframe
          className="tw:h-64 tw:w-full tw:rounded-xs tw:border-0 tw:bg-background"
          referrerPolicy="no-referrer"
          sandbox=""
          srcDoc={state.sourceDocument}
          title={labels.diagram}
        />
      ) : (
        <p className="tw:m-0 tw:text-xs tw:text-danger">
          {labels.diagramError}
        </p>
      )}
      <details className="tw:max-w-full tw:min-w-0 tw:overflow-hidden tw:text-xs">
        <summary className="tw:cursor-pointer tw:text-muted-foreground">
          {labels.diagramSource}
        </summary>
        <div className="tw:mt-2">
          <AgentCodeBlock
            code={code}
            copiedLabel={labels.copied}
            copyLabel={labels.copyCode}
            highlight={false}
            language="mermaid"
          />
        </div>
      </details>
    </section>
  );
}

type MermaidApi = Awaited<typeof import("mermaid")>["default"];
let mermaidPromise: Promise<MermaidApi> | null = null;

function getMermaid() {
  mermaidPromise ??= import("mermaid").then(({ default: mermaid }) => mermaid);
  return mermaidPromise;
}

// Mermaid keeps global configuration. Serialize initialization and rendering so
// diagrams created while appearance changes cannot mix two palettes.
let mermaidRenderQueue: Promise<unknown> = Promise.resolve();
function renderMermaid(id: string, code: string) {
  const render = mermaidRenderQueue.then(() => renderThemedMermaid(id, code));
  mermaidRenderQueue = render.catch(() => undefined);
  return render;
}

async function renderThemedMermaid(id: string, code: string) {
  const mermaid = await getMermaid();
  const roles = getComputedStyle(document.documentElement);
  const role = (name: string) => roles.getPropertyValue(name).trim();
  const colorScheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  mermaid.initialize({
    fontFamily: role("--ds-font-sans"),
    htmlLabels: false,
    securityLevel: "strict",
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: "base",
    themeVariables: {
      darkMode: colorScheme === "dark",
      background: role("--ds-background"),
      lineColor: role("--ds-muted-foreground"),
      primaryBorderColor: role("--ds-border-strong"),
      primaryColor: role("--ds-muted"),
      primaryTextColor: role("--ds-foreground"),
      secondaryColor: role("--ds-card"),
      tertiaryColor: role("--ds-selection"),
    },
  });
  const { svg } = await mermaid.render(id, code);
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue("--ds-background")
    .trim();
  return diagramSourceDocument(svg, background, colorScheme);
}

function diagramSourceDocument(svg: string, background: string, colorScheme: "light" | "dark") {
  const surface = background || "transparent";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>html,body{margin:0;min-height:100%;background:${surface};color-scheme:${colorScheme};overflow:auto}body{box-sizing:border-box;display:grid;place-items:center;padding:8px}svg{display:block;max-width:100%;height:auto;margin:auto;background:transparent!important}</style></head><body>${svg}</body></html>`;
}

function fenceLanguage(className?: string) {
  const match = /(?:^|\s)language-([a-zA-Z0-9_-]+)/.exec(className ?? "");
  return match?.[1]?.toLocaleLowerCase() ?? null;
}

function safeAgentUrl(value: string, key: string) {
  if (key === "src") return null;
  const safe = defaultUrlTransform(value);
  return isExternalAgentUrl(safe) ? safe : null;
}

function isExternalAgentUrl(value: string) {
  return /^(https?:|mailto:)/i.test(value);
}

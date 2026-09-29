// Shared presentation of server-sanitized Article HTML in Desktop and Workspace
// Web. Author content owns measured geometry; this primitive owns document styling.
export function AnalysisArticleBody({ html, bodyRef }: {
  html: string;
  bodyRef?: { current: HTMLDivElement | null };
}) {
  return (
    <div
      ref={bodyRef}
      className="tw:grid tw:min-w-0 tw:max-w-full tw:gap-5 tw:font-sans tw:text-body tw:leading-[1.65] tw:break-words tw:[&>*]:min-w-0 tw:[&_a]:text-primary tw:[&_a]:underline tw:[&_h2]:m-0 tw:[&_h2]:font-sans tw:[&_h2]:text-[22px] tw:[&_h2]:leading-tight tw:[&_h2]:font-semibold tw:[&_h2]:tracking-tight tw:[&_h2]:scroll-mt-8 tw:[&_h3]:m-0 tw:[&_h3]:font-sans tw:[&_h3]:text-title tw:[&_h3]:font-semibold tw:[&_h3]:normal-case tw:[&_h3]:tracking-tight tw:[&_h3]:scroll-mt-8 tw:[&_h4]:m-0 tw:[&_h4]:text-title tw:[&_h4]:font-semibold tw:[&_p]:m-0 tw:[&_section]:grid tw:[&_section]:min-w-0 tw:[&_section]:gap-4 tw:[&_ul]:pl-6 tw:[&_ol]:pl-6 tw:[&_code]:font-mono tw:[&_pre]:min-w-0 tw:[&_pre]:overflow-auto tw:[&_pre]:rounded-md tw:[&_pre]:bg-card tw:[&_pre]:p-4 tw:[&_blockquote]:m-0 tw:[&_blockquote]:border-l-2 tw:[&_blockquote]:border-border-subtle tw:[&_blockquote]:pl-4 tw:[&_table]:block tw:[&_table]:max-w-full tw:[&_table]:overflow-x-auto tw:[&_table]:border-collapse tw:[&_td]:border-b tw:[&_td]:border-border-subtle tw:[&_td]:p-3 tw:[&_th]:border-b tw:[&_th]:border-border-subtle tw:[&_th]:p-3 tw:[&_caption]:text-left tw:[&_caption]:text-sm tw:[&_figure]:m-0 tw:[&_figure]:grid tw:[&_figure]:min-w-0 tw:[&_figure]:gap-3 tw:[&_figure]:py-3 tw:[&_figcaption]:text-sm tw:[&_figcaption]:text-muted-foreground tw:[&_svg]:block tw:[&_svg]:h-auto tw:[&_svg]:w-full tw:[&_svg]:max-w-full tw:[&_svg]:overflow-hidden tw:[&_.article-metrics]:grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] tw:[&_.article-metrics]:gap-x-6 tw:[&_.article-metrics]:gap-y-4 tw:[&_.article-metric]:grid tw:[&_.article-metric]:gap-2 tw:[&_.article-metric]:content-start tw:[&_.article-metric]:border-t tw:[&_.article-metric]:border-border-subtle tw:[&_.article-metric]:py-4 tw:[&_.article-kicker]:text-sm tw:[&_.article-kicker]:text-muted-foreground tw:[&_.article-value]:text-[clamp(28px,4cqw,36px)] tw:[&_.article-value]:leading-tight tw:[&_.article-value]:tracking-tight tw:[&_.article-value]:font-semibold tw:[&_.article-value]:tabular-nums tw:[&_.article-note]:border-l-2 tw:[&_.article-note]:border-border-subtle tw:[&_.article-note]:pl-4 tw:[&_.article-note]:text-sm tw:[&_.article-note]:text-muted-foreground tw:[&_.article-accent]:text-primary tw:[&_.article-muted]:text-muted-foreground"
      // Only the Workspace's closed HTML/SVG sanitizer supplies this string.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

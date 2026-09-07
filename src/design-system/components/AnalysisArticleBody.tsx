// Shared presentation of server-sanitized Article HTML in Desktop and Workspace
// Web. Author content owns measured geometry; this primitive owns document styling.
export function AnalysisArticleBody({ html, bodyRef }: {
  html: string;
  bodyRef?: { current: HTMLDivElement | null };
}) {
  return (
    <div
      ref={bodyRef}
      className="tw:grid tw:min-w-0 tw:max-w-full tw:gap-6 tw:font-sans tw:text-body tw:leading-[1.75] tw:break-words tw:[&>*]:min-w-0 tw:[&_a]:text-primary tw:[&_a]:underline tw:[&_h2]:m-0 tw:[&_h2]:font-serif tw:[&_h2]:text-[28px] tw:[&_h2]:leading-tight tw:[&_h2]:font-normal tw:[&_h2]:tracking-tight tw:[&_h2]:scroll-mt-8 tw:[&_h3]:m-0 tw:[&_h3]:font-serif tw:[&_h3]:text-[23px] tw:[&_h3]:font-normal tw:[&_h3]:normal-case tw:[&_h3]:tracking-tight tw:[&_h3]:scroll-mt-8 tw:[&_h4]:m-0 tw:[&_h4]:text-base tw:[&_h4]:font-semibold tw:[&_p]:m-0 tw:[&_section]:grid tw:[&_section]:min-w-0 tw:[&_section]:gap-4 tw:[&_ul]:pl-6 tw:[&_ol]:pl-6 tw:[&_code]:font-mono tw:[&_pre]:min-w-0 tw:[&_pre]:overflow-auto tw:[&_pre]:rounded-md tw:[&_pre]:bg-card tw:[&_pre]:p-4 tw:[&_blockquote]:m-0 tw:[&_blockquote]:border-l-2 tw:[&_blockquote]:border-border-subtle tw:[&_blockquote]:pl-4 tw:[&_table]:block tw:[&_table]:max-w-full tw:[&_table]:overflow-x-auto tw:[&_table]:border-collapse tw:[&_td]:border tw:[&_td]:border-border-subtle tw:[&_td]:p-3 tw:[&_th]:border tw:[&_th]:border-border-subtle tw:[&_th]:bg-card tw:[&_th]:p-3 tw:[&_caption]:text-left tw:[&_caption]:text-sm tw:[&_figure]:m-0 tw:[&_figure]:grid tw:[&_figure]:min-w-0 tw:[&_figure]:gap-3 tw:[&_figure]:rounded-lg tw:[&_figure]:border tw:[&_figure]:border-border-subtle tw:[&_figure]:bg-card tw:[&_figure]:p-4 tw:[&_figcaption]:text-sm tw:[&_figcaption]:text-muted-foreground tw:[&_svg]:block tw:[&_svg]:h-auto tw:[&_svg]:w-full tw:[&_svg]:max-w-full tw:[&_svg]:overflow-hidden tw:[&_.article-metrics]:grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] tw:[&_.article-metric]:grid tw:[&_.article-metric]:gap-2 tw:[&_.article-metric]:rounded-lg tw:[&_.article-metric]:border tw:[&_.article-metric]:border-border-subtle tw:[&_.article-metric]:p-4 tw:[&_.article-kicker]:text-sm tw:[&_.article-kicker]:text-muted-foreground tw:[&_.article-value]:text-3xl tw:[&_.article-value]:font-semibold tw:[&_.article-value]:tabular-nums tw:[&_.article-note]:rounded-md tw:[&_.article-note]:border tw:[&_.article-note]:border-border-subtle tw:[&_.article-note]:bg-card tw:[&_.article-note]:p-5 tw:[&_.article-accent]:text-primary tw:[&_.article-muted]:text-muted-foreground"
      // Only the Workspace's closed HTML/SVG sanitizer supplies this string.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

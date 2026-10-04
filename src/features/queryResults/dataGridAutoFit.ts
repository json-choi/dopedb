// Measures one column on explicit user request using rendered typography and
// already-loaded display text. No database reads or persistent width changes.
const AUTO_FIT_MAXIMUM = 480;

export function dataGridAutoFitWidth(
  header: HTMLElement,
  texts: Iterable<string>,
  minimum: number,
) {
  const context = document.createElement("canvas").getContext("2d");
  const label = header.querySelector<HTMLElement>("[data-grid-column-label]");
  if (!context || !label) return header.getBoundingClientRect().width;
  const pixels = (value: string) => parseFloat(value) || 0;
  const measure = (text: string, style: CSSStyleDeclaration) => {
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const displayed = text.replace(/[\t\r\n\f ]+/g, " ").trim();
    return (
      context.measureText(displayed).width +
      Math.max(0, Array.from(displayed).length - 1) * pixels(style.letterSpacing)
    );
  };
  const headerStyle = getComputedStyle(header);
  let headerPadding = pixels(headerStyle.borderRightWidth);
  // Include the real metadata/sort icons, filter button, gaps and handle inset.
  for (let child: HTMLElement = label; child !== header;) {
    const parent = child.parentElement!;
    const style = getComputedStyle(parent);
    headerPadding +=
      pixels(style.paddingLeft) + pixels(style.paddingRight) +
      Math.max(0, parent.children.length - 1) * pixels(style.columnGap);
    for (const sibling of parent.children) {
      if (sibling !== child && !sibling.hasAttribute("data-grid-resize-handle")) {
        headerPadding += sibling.getBoundingClientRect().width;
      }
    }
    child = parent;
  }
  const grid = header.closest("[data-data-grid-scroll]");
  const cell = grid?.querySelector<HTMLElement>(
    `[role=gridcell][aria-colindex="${header.getAttribute("aria-colindex")}"]`,
  );
  const bodyStyle = getComputedStyle(cell ?? header.parentElement!.parentElement!);
  const bodyPadding = cell
    ? pixels(bodyStyle.paddingLeft) + pixels(bodyStyle.paddingRight) +
      pixels(bodyStyle.borderRightWidth)
    : pixels(headerStyle.paddingLeft) + pixels(headerStyle.paddingRight);
  let width = Math.max(
    minimum,
    measure(label.textContent ?? "", getComputedStyle(label)) + headerPadding,
  );
  for (const text of texts) {
    if (width >= AUTO_FIT_MAXIMUM) break;
    width = Math.max(width, measure(text, bodyStyle) + bodyPadding);
  }
  return Math.min(AUTO_FIT_MAXIMUM, Math.ceil(width));
}

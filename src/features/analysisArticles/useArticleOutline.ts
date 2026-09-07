// Observes the rendered, server-sanitized document without rewriting its HTML.
// The outline only navigates headings in this exact reader and never executes content.
import { useEffect, useRef, useState } from "react";

export function useArticleOutline(html: string) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRefs = useRef<HTMLElement[]>([]);
  const [headings, setHeadings] = useState<Array<{ title: string; nested: boolean }>>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const root = scrollRef.current;
    const elements = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("h2, h3") ?? [])
      .filter((heading) => heading.textContent?.trim()).slice(0, 64);
    headingRefs.current = elements;
    setHeadings(elements.map((heading) => ({ title: heading.textContent!.trim(), nested: heading.tagName === "H3" })));
    setActive(0);
    if (!root || !elements.length) return;
    const update = () => {
      if (root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
        setActive(elements.length - 1);
        return;
      }
      const top = root.getBoundingClientRect().top + 96;
      const next = elements.findIndex((heading) => heading.getBoundingClientRect().top > top);
      setActive(next === -1 ? elements.length - 1 : Math.max(0, next - 1));
    };
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = new IntersectionObserver(schedule, { root, rootMargin: "-12% 0px -65% 0px", threshold: 0 });
    elements.forEach((heading) => observer.observe(heading));
    root.addEventListener("scroll", schedule, { passive: true });
    return () => { observer.disconnect(); root.removeEventListener("scroll", schedule); cancelAnimationFrame(frame); };
  }, [html]);

  function navigate(index: number) {
    const heading = headingRefs.current[index];
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start" });
    setActive(index);
  }

  return { scrollRef, bodyRef, headings, active, navigate };
}

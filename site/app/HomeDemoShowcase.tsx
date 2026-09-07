// Current Desktop capture uses only the bundled local SQLite demo.
import Image from "next/image";
import type { HomeCopy } from "./homeContent";

export function HomeDemoShowcase({ product }: { product: HomeCopy["product"] }) {
  return (
    <div className="tw:relative tw:mt-[clamp(52px,7vw,94px)] tw:mx-auto tw:max-w-[1200px]">
      <figure className="tw:m-0 tw:overflow-hidden tw:border tw:border-hairline-strong tw:bg-night-raised tw:p-2 tw:shadow-stage">
        <a href={product.imageSrc} aria-label={product.imageAlt}>
          <Image
            src={product.imageSrc}
            alt={product.imageAlt}
            width={2400}
            height={1600}
            sizes="(max-width: 2400px) 100vw, 1200px"
            className="tw:block tw:h-auto tw:w-full"
          />
        </a>
        <figcaption className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:px-2 tw:pt-3 tw:pb-1 tw:font-mono tw:text-[10px] tw:text-cream-muted">
          <span className="tw:text-signal">{product.captureLabel}</span>
          <span>{product.captureDetail}</span>
        </figcaption>
      </figure>
      <div className="tw:mt-3 tw:flex tw:flex-wrap tw:gap-2">
        {product.labels.map((label) => (
          <span className="tw:border tw:border-hairline tw:bg-night-raised tw:px-3 tw:py-2 tw:font-mono tw:text-[10px] tw:text-cream-muted" key={label.title}>
            <span className="tw:text-electric">{label.title}</span>
            <span className="tw:mx-2 tw:text-cream/20">/</span>
            {label.body}
          </span>
        ))}
      </div>
    </div>
  );
}

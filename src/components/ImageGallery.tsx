"use client";

import { useState } from "react";
import type { AmazonImage } from "@/lib/types";

export default function ImageGallery({ images, alt }: { images: AmazonImage[]; alt: string }) {
  const [active, setActive] = useState(0);
  if (!images.length) {
    return (
      <div className="gallery">
        <div className="main-img" style={{ color: "var(--muted)" }}>
          No images
        </div>
      </div>
    );
  }
  const current = images[Math.min(active, images.length - 1)];
  return (
    <div className="gallery">
      <div className="main-img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.link} alt={`${alt} — ${current.variant}`} />
      </div>
      {images.length > 1 && (
        <div className="thumbs">
          {images.map((img, i) => (
            <button
              key={img.variant + i}
              className={i === active ? "active" : ""}
              onClick={() => setActive(i)}
              title={img.variant}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.link} alt={img.variant} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

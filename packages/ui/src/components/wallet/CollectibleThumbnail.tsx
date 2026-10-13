import { useEffect, useState } from "react";
import { cn } from "../../primitives/cn";

/**
 * A square collectible preview. The image loads only through `<img>`:
 * an NFT's media is untrusted, and an element that can run script or
 * navigate (iframe, object, embed) is never an option. Without an image,
 * or when it fails to load, a plain neutral tile with a file icon stands in.
 */
export interface CollectibleThumbnailProps {
  name: string;
  imageUrl?: string;
  className?: string;
}

export function CollectibleThumbnail({ name, imageUrl, className }: CollectibleThumbnailProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => setFailedUrl(null), [imageUrl]);

  const showImage = imageUrl !== undefined && imageUrl !== failedUrl;

  return (
    <div className={cn("relative aspect-square w-full overflow-hidden rounded-lg bg-mist", className)}>
      {showImage ? (
        <img
          src={imageUrl}
          alt={name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(imageUrl)}
          className="h-full w-full object-cover"
          style={{ objectFit: "cover" }}
        />
      ) : (
        <div data-testid="collectible-placeholder" className="flex h-full w-full items-center justify-center text-faint">
          <FileIcon />
        </div>
      )}
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

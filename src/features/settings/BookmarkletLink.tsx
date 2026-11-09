import { useEffect, useRef } from 'react';
import { bookmarkletHref } from '../../lib/capture/bookmarklet';
import { buttonClasses } from '../../ui/buttonClasses';

/**
 * The "Send to Airhead" bookmarklet to drag to the bookmarks bar (Task 7.4).
 * React refuses `javascript:` links in JSX, so the address is set on the
 * element directly once it is on the page.
 */
export default function BookmarkletLink({ origin = window.location.origin }: { origin?: string }) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    link.current?.setAttribute('href', bookmarkletHref(origin));
  }, [origin]);
  return (
    <div className="space-y-1 text-footnote">
      <p className="text-fg-muted">
        Desktop Chrome: drag this to your bookmarks bar, then click it on any page to save the page
        (and any selected text).
      </p>
      <a
        ref={link}
        draggable
        onClick={(e) => e.preventDefault()}
        className={buttonClasses('primary', 'sm')}
      >
        Send to Airhead
      </a>
    </div>
  );
}

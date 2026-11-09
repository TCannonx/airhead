import { ingestUrl } from '../../lib/capture/ingestUrl';
import { Button } from '../../ui/Button';

const steps = 'list-decimal space-y-1 pl-5';

/**
 * The in-app version of docs/SETUP-SHORTCUTS.md (Task 7.3): how to build the
 * two Shortcuts, with this account's address to paste.
 */
export default function ShortcutsGuide({ url = ingestUrl() }: { url?: string }) {
  return (
    <details className="text-footnote">
      <summary className="cursor-pointer font-semibold">Set up the iOS Shortcuts</summary>
      <div className="mt-2 space-y-3">
        <div>
          <p className="text-fg-muted">Address for “Get Contents of URL”:</p>
          <code className="block break-all rounded bg-fill p-2">{url}</code>
          <Button
            variant="plain"
            size="sm"
            className="mt-1"
            onClick={() => void navigator.clipboard?.writeText(url)}
          >
            Copy address
          </Button>
        </div>
        <div>
          <h4 className="font-semibold">Send to Airhead (share sheet)</h4>
          <ol className={steps}>
            <li>Shortcuts → + → name it “Send to Airhead”; in ⓘ turn on Show in Share Sheet.</li>
            <li>
              If the input is an image: Convert Image to JPEG, Base64 Encode (no line breaks), then
              Get Contents of URL with JSON <code>image</code> and <code>image_type</code> =
              image/jpeg.
            </li>
            <li>
              Otherwise: Get Contents of URL with JSON <code>text</code> = Shortcut Input.
            </li>
            <li>
              Both: method POST, header <code>Authorization</code> = <code>Bearer</code> + your
              token. Finish with Show Result.
            </li>
          </ol>
        </div>
        <div>
          <h4 className="font-semibold">Quick thought (Back Tap or Action Button)</h4>
          <ol className={steps}>
            <li>
              Shortcuts → + → “Quick thought”: Dictate Text, then Get Contents of URL as above with
              JSON <code>text</code> = Dictated Text, then Show Notification.
            </li>
            <li>
              Settings → Accessibility → Touch → Back Tap → Double Tap → Quick thought (or Settings
              → Action Button → Shortcut).
            </li>
          </ol>
        </div>
        <p className="text-fg-muted">
          No connection? The Shortcut stops with an error — open Airhead and capture there; it works
          offline and syncs later.
        </p>
      </div>
    </details>
  );
}

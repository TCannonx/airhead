# Capture from anywhere: iOS Shortcuts

Two Shortcuts send captures straight to Airhead, even when the app is closed:

- **Send to Airhead**: from the share sheet, for links, text and photos.
- **Quick thought**: from Back Tap or the Action Button, for a line you say or type.

Each Shortcut posts to Airhead's `ingest-capture` function with a **capture token**. Captures arrive in the Inbox as Unsorted, and sorting handles them as usual. Airhead → Settings → Capture from anywhere shows the exact address and has a Copy button for it.

## 1. Make a capture token

1. Open Airhead → **Settings** → **Capture from anywhere**.
2. Type a name (e.g. "iPhone Shortcuts") and tap **Create token**.
3. Tap **Copy**. The token is shown only once; if you lose it, revoke it and make a new one.

Keep the token private: anyone who has it can add captures to your Inbox (and nothing else).

## 2. "Send to Airhead" (share sheet)

1. Open the **Shortcuts** app → **+** (new shortcut). Name it **Send to Airhead**.
2. Tap the **ⓘ** (details) button → turn on **Show in Share Sheet**. Under **Share Sheet Types**, keep **URLs**, **Text** and **Images**.
3. Add these actions in order:
   1. **If** *Shortcut Input* **is** *Image*:
      - **Convert Image** *Shortcut Input* to **JPEG**.
      - **Base64 Encode** the converted image (Line Breaks: **None**).
      - **Get Contents of URL**:
        - URL: `https://<your-project>.supabase.co/functions/v1/ingest-capture`
        - Method: **POST**
        - Headers: `Authorization` = `Bearer <your token>`
        - Request Body: **JSON**, with `image` = *Base64 Encoded*, `image_type` = `image/jpeg`
   2. **Otherwise**:
      - **Get Contents of URL** with the same URL, method and header. Request Body is **JSON** with `text` = *Shortcut Input*.
   3. **End If**.
4. Add **Show Result** with *Contents of URL*: it shows "Saved to Airhead." or what went wrong.
5. Error handling: Shortcuts stops with an error when there is no connection. Then open Airhead itself; the Capture tab works offline and syncs later.

## 3. "Quick thought" (Back Tap or Action Button)

1. Shortcuts → **+**. Name it **Quick thought**.
2. Add **Dictate Text** (or **Ask for Input** to type), stopping **After Pause**.
3. Add **Get Contents of URL**: the same URL, POST, `Authorization` header and JSON body `text` = *Dictated Text*.
4. Add **Show Notification** with *Contents of URL*.
5. Run it from:
   - **Back Tap**: Settings → Accessibility → Touch → Back Tap → Double Tap → **Quick thought**.
   - **Action Button** (iPhone 15 Pro and later): Settings → Action Button → Shortcut → **Quick thought**.

## Limits and safety

- At most 60 captures per token per hour; text up to 20,000 characters; photos up to 5 MB (JPEG, PNG, WebP or HEIC).
- Captures are saved exactly as sent and are treated as data: nothing in a capture can change settings or act on your account.
- Lost a phone? Settings → Capture from anywhere → **Revoke**. That token stops working at once.

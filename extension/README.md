# TenderPilot Browser Extension (Generate + Fill MVP)

## Purpose
Collect portal questions from the current page, call TenderPilot `/api/tender/draft`, and autofill answers in one click.

## Load in Chrome
1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click **Load unpacked**
4. Select this `extension/` folder

## Usage
1. Open buyer portal page.
2. Open extension popup.
3. Enter:
   - `API Base URL` (for local dev: `http://localhost:8787`)
   - `Access Token` (TenderPilot JWT)
   - `Workspace ID`
4. Click **Generate + Fill**.

## Manual fallback
- You can still paste JSON in `Manual Draft JSON` and click **Fill Using Manual JSON**.

## Notes
- Current matcher is text-based and works best when portal labels/placeholder text are close to question wording.
- For production quality, add domain-specific field mappers and portal adapters.

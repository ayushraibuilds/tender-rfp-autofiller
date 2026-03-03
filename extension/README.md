# TenderPilot Browser Extension (MVP)

## Purpose
One-click fill buyer portal forms from TenderPilot draft JSON.

## Load in Chrome
1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click **Load unpacked**
4. Select this `extension/` folder

## Usage
1. In TenderPilot app, copy draft JSON from portal export (JSON format).
2. Open buyer portal page.
3. Open extension popup.
4. Paste JSON and click **Fill Current Page**.

## Notes
- Current matcher is text-based and works best when form labels closely match draft questions.
- For production quality, add domain-specific field mappers and portal adapters.

CIVIC CONNECT — COMBINED HACKATHON BUILD

This build combines BOTH requested reference designs:
1. Report a Problem form / Google Maps-style location UI
2. Reference-matched Statistics cards

Files:
- index.html
- style.css
- script.js

Run with VS Code Live Server for GPS/geolocation support.

Existing functionality preserved:
- GPS + reverse geocoding
- Google Maps preview/link
- photo upload + IndexedDB
- issue search/filter
- status updates
- statistics + progress tracker
- responsive navigation


Donation payment: replace CIVIC_DONATION_UPI_ID in script.js with the real receiving UPI ID. App buttons attempt the selected UPI app and fall back to the standard UPI payment URI. Bank app deep links are not standardized, so bank selections use the UPI chooser.

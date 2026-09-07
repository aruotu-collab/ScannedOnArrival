# ScannedOnArrival

A local-first document readiness **web app**. Open it in your phone or computer browser. It is not an App Store app; you can optionally add it to your Home Screen.

When we say **scan**, we mean point your phone at the paper, using this page’s camera.

It answers three questions:

- What documents do I have?
- How current are they?
- Where is the latest copy?

## Run

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually `http://localhost:5173`). On a computer you can browse the index and upload PDFs. To scan a letter, open that same URL on your phone, or scan the QR on the Ready page.

## First version

- Scan with your phone (browser camera)
- Upload PDF or image (processed in the browser)
- Add from Files, or reference a location without duplicating the file
- Ready, Documents, and Tree views
- Optional email inbox / mailbox connection UI, off by default

## Phone and Home Screen

- **Add to Home Screen** — Chrome can install the site; Safari uses Share → Add to Home Screen
- **Share in** — after install, Android Chrome can share a PDF or photo from Mail or Files into the app. iPhone does not support Share Target; use Add from Files or the camera roll
- **OCR** — camera and image scans are read in the browser, then classified. The English language model may download once on first scan
- **Desktop QR** — the Ready page shows a code that opens `/?scan=1` on your phone, ready to photograph a letter

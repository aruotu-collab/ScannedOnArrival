# ScannedOnArrival

A local-first document readiness **web app**. Open it in your phone or computer browser — nothing to install.

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

Then open the local URL Vite prints (usually `http://localhost:5173`). On a computer you can browse the index and upload PDFs. To scan a letter, open that same URL on your phone.

## First version

- Scan with your phone (browser camera)
- Upload PDF or image (processed in the browser)
- Add from Files, or reference a location without duplicating the file
- Ready, Documents, and Tree views
- Optional email inbox / mailbox connection UI, off by default

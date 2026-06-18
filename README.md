# Soniox Audio Transcription

A small single-page React app for uploading audio files, creating Soniox async transcription jobs, polling job status, downloading completed transcripts, and deleting uploaded files.

## Setup

1. Install Node.js 20+ and a package manager such as `npm`, `pnpm`, or `yarn`.
2. Run:

```bash
npm install
```

3. Start the app:

```bash
npm run dev
```

4. Open the local Vite URL shown in the terminal.

## Usage

- Paste your Soniox API key into the `Soniox API Key` field.
- Select one or more audio files.
- Click `Submit for transcription`.
- Watch uploaded files and transcription job status.
- Download completed transcripts using the button shown for each file.
- Delete the uploaded Soniox file after transcription completes.

## Notes

- The app uses the Soniox REST endpoints at `https://api.soniox.com/v1`.
- Only audio MIME types are accepted.
- This project is built with React 18, TypeScript, and Vite.

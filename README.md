# Soniox Audio Transcription

A small single-page React app for uploading audio files, creating Soniox async transcription jobs, polling job status, downloading completed transcripts, and deleting uploaded files.

## Setup

1. Install Node.js 20+ and a package manager such as `npm`, `pnpm`, or `yarn`.
2. Create a `.env` file at the project root with:

```env
VITE_SONIOX_API_KEY=your_api_key
```

3. Run:

```bash
npm install
```

4. Start the app:

```bash
npm run dev
```

4. Open the local Vite URL shown in the terminal.

## Usage

- Add your Soniox API key to `.env` as `VITE_SONIOX_API_KEY=your_api_key`.
- Select one or more audio files.
- Click `Submit for transcription`.
- Watch uploaded files and transcription job status.
- Download completed transcripts using the button shown for each file or download all transcripts at once.
- Delete the uploaded Soniox file after transcription completes, or delete all Soniox files in bulk.

## Notes

- The app uses the Soniox REST endpoints at `https://api.soniox.com/v1`.
- Only audio MIME types are accepted.
- This project is built with React 18, TypeScript, and Vite.

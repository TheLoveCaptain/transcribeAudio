import JSZip from 'jszip';
import { useEffect, useMemo, useState } from 'react';

type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

type AudioFile = {
  id: string;
  file: File;
  filename: string;
  uploadStatus: 'ready' | 'uploading' | 'uploaded' | 'failed';
  fileId?: string;
  transcriptionId?: string;
  transcriptionStatus?: JobStatus;
  transcriptText?: string;
  error?: string;
};

const baseUrl = 'https://api.soniox.com/v1';

const allowedAudioTypes = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/aiff',
  'audio/x-aiff'
];

function App() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [polling, setPolling] = useState(false);
  const apiKey = import.meta.env.VITE_SONIOX_API_KEY || '';
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['en']);
  const [restrictToOneLanguage, setRestrictToOneLanguage] = useState(true);
  const [speakerDiarization, setSpeakerDiarization] = useState(true);

  useEffect(() => {
    if (!polling) return;
    const interval = window.setInterval(() => {
      pollTranscriptions();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [polling, files]);

  useEffect(() => {
    setRestrictToOneLanguage(selectedLanguages.length === 1);
  }, [selectedLanguages]);

  const fileInputAccept = useMemo(
    () => allowedAudioTypes.join(','),
    []
  );

  const selectedCount = files.length;
  const hasJobs = files.some((file) => file.transcriptionId);
  const anyPending = files.some(
    (file) => file.transcriptionStatus && file.transcriptionStatus !== 'completed' && file.transcriptionStatus !== 'failed'
  );

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const selectedFiles = event.target.files;
    if (!selectedFiles) return;

    const newFiles: AudioFile[] = [];
    for (const file of Array.from(selectedFiles)) {
      if (!allowedAudioTypes.includes(file.type)) {
        setError(`Unsupported file type: ${file.name}`);
        continue;
      }
      const id = `${file.name}-${file.size}-${file.lastModified}`;
      if (files.some((item) => item.id === id)) continue;
      newFiles.push({
        id,
        file,
        filename: file.name,
        uploadStatus: 'ready'
      });
    }
    if (newFiles.length > 0) {
      setFiles((prev) => [...prev, ...newFiles]);
    }
    event.target.value = '';
  };

  const uploadAudioFile = async (audioFile: AudioFile) => {
    const formData = new FormData();
    formData.append('file', audioFile.file, audioFile.filename);
    formData.append('client_reference_id', audioFile.id);

    const response = await fetch(`${baseUrl}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || 'File upload failed');
    }

    const payload = await response.json();
    return payload.id as string;
  };

  const createTranscription = async (fileId: string, filename: string) => {
    const payload: Record<string, any> = {
      model: 'stt-async-v5',
      file_id: fileId,
      filename,
      client_reference_id: filename,
      language_hints: selectedLanguages,
      enable_speaker_diarization: speakerDiarization
    };

    if (restrictToOneLanguage && selectedLanguages.length === 1) {
      payload.language_hints_strict = true;
    }

    const response = await fetch(`${baseUrl}/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || 'Transcription creation failed');
    }

    const body = await response.json();
    return body.id as string;
  };

  const submitForTranscription = async () => {
    if (!apiKey) {
      setError('Enter your Soniox API key first.');
      return;
    }

    setError(null);
    setSuccessMessage('Uploading files and starting transcription...');
    const updatedFiles = [...files];

    for (const [index, file] of updatedFiles.entries()) {
      if (file.transcriptionId || file.uploadStatus === 'uploading') continue;
      try {
        updatedFiles[index] = { ...file, uploadStatus: 'uploading', error: undefined };
        setFiles([...updatedFiles]);

        const fileId = await uploadAudioFile(file);
        const transcriptionId = await createTranscription(fileId, file.filename);

        updatedFiles[index] = {
          ...file,
          uploadStatus: 'uploaded',
          fileId,
          transcriptionId,
          transcriptionStatus: 'queued'
        };
        setFiles([...updatedFiles]);
      } catch (err) {
        updatedFiles[index] = {
          ...file,
          uploadStatus: 'failed',
          error: err instanceof Error ? err.message : String(err)
        };
        setFiles([...updatedFiles]);
      }
    }

    setSuccessMessage('Transcription jobs created. Polling status every 5 seconds.');
    setPolling(true);
  };

  const pollTranscriptions = async () => {
    if (!apiKey) return;

    const updatedFiles = [...files];
    let anyActive = false;

    await Promise.all(
      files.map(async (file, index) => {
        if (!file.transcriptionId || file.transcriptionStatus === 'completed' || file.transcriptionStatus === 'failed') {
          return;
        }

        try {
          const response = await fetch(`${baseUrl}/transcriptions/${file.transcriptionId}`, {
            headers: {
              Authorization: `Bearer ${apiKey}`
            }
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.message || 'Failed to poll transcription');
          }

          const body = await response.json();
          const status = body.status as JobStatus;
          updatedFiles[index] = {
            ...file,
            transcriptionStatus: status,
            error: body.error_message || undefined
          };

          if (status === 'completed') {
            const transcriptResp = await fetch(`${baseUrl}/transcriptions/${file.transcriptionId}/transcript`, {
              headers: {
                Authorization: `Bearer ${apiKey}`
              }
            });
            if (transcriptResp.ok) {
              const transcriptBody = await transcriptResp.json();
              updatedFiles[index] = {
                ...updatedFiles[index],
                transcriptText: transcriptBody.text || ''
              };
            }
          }

          if (status !== 'completed' && status !== 'failed') {
            anyActive = true;
          }
        } catch (err) {
          updatedFiles[index] = {
            ...file,
            error: err instanceof Error ? err.message : String(err)
          };
          anyActive = true;
        }
      })
    );

    setFiles(updatedFiles);
    setPolling(anyActive);
  };

  const deleteSonioxFile = async (file: AudioFile) => {
    if (!apiKey || !file.fileId) return;
    setError(null);

    const response = await fetch(`${baseUrl}/files/${file.fileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || 'Failed to delete Soniox file');
      return;
    }

    setFiles((prev) => prev.filter((item) => item.id !== file.id));
    setSuccessMessage(`Deleted Soniox file for ${file.filename}`);
  };

  const saveTranscript = (file: AudioFile) => {
    if (!file.transcriptText) return;
    const blob = new Blob([file.transcriptText], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${file.filename}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const saveAllTranscripts = async () => {
    const completedFiles = files.filter((file) => file.transcriptText);
    if (!completedFiles.length) return;

    const zip = new JSZip();
    completedFiles.forEach((file) => {
      zip.file(`${file.filename}.txt`, file.transcriptText || '');
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'all-transcripts.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const deleteAllSonioxFiles = async () => {
    if (!apiKey) {
      setError('Soniox API key is not configured in .env');
      return;
    }

    setError(null);
    const deletableFiles = files.filter((file) => file.fileId);
    let anyFailed = false;

    for (const file of deletableFiles) {
      try {
        const response = await fetch(`${baseUrl}/files/${file.fileId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${apiKey}`
          }
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          anyFailed = true;
          setError(body?.message || `Failed to delete ${file.filename}`);
        }
      } catch (err) {
        anyFailed = true;
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    if (!anyFailed) {
      setSuccessMessage('Deleted all Soniox files from the list.');
    }

    setFiles((prev) => prev.filter((file) => !file.fileId));
  };

  const clearAll = () => {
    setFiles([]);
    setError(null);
    setSuccessMessage(null);
    setPolling(false);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Soniox Async Transcription</p>
          <h1>Transcribe audio files</h1>
          <p className="description">
            Upload one or more audio files, submit them to Soniox async transcription, and download transcripts when complete.
          </p>
        </div>
      </header>

      <section className="controls-card">
        <div className="button-row">
          <label className="upload-button">
            Select audio files
            <input
              type="file"
              accept={fileInputAccept}
              multiple
              onChange={handleFileSelection}
            />
          </label>
          <button className="primary-button" onClick={submitForTranscription} disabled={!files.length || !apiKey || files.every((file) => file.transcriptionId)}>
            Submit for transcription
          </button>
          <button className="secondary-button" onClick={saveAllTranscripts} disabled={!files.some((file) => file.transcriptText)}>
            Download all transcripts
          </button>
          <button className="secondary-button danger" onClick={deleteAllSonioxFiles} disabled={!files.some((file) => file.fileId)}>
            Delete all Soniox files
          </button>
          <button className="secondary-button" onClick={clearAll}>
            Clear all
          </button>
        </div>

        <div className="settings-card">
          <label className="field-label">Language hints</label>
          <select
            multiple
            value={selectedLanguages}
            onChange={(event) => {
              const values = Array.from(event.target.selectedOptions, (opt) => opt.value);
              setSelectedLanguages(values);
            }}
          >
            <option value="en">en</option>
            <option value="es">es</option>
          </select>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={restrictToOneLanguage}
              disabled={selectedLanguages.length !== 1}
              onChange={(event) => setRestrictToOneLanguage(event.target.checked)}
            />
            Restrict to 1 language
          </label>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={speakerDiarization}
              onChange={(event) => setSpeakerDiarization(event.target.checked)}
            />
            Speaker diarization
          </label>
        </div>

        {!apiKey && (
          <div className="toast toast-error">
            No Soniox API key found. Add `VITE_SONIOX_API_KEY=your_api_key` to a `.env` file.
          </div>
        )}

        <p className="meta-text">{selectedCount} file{selectedCount === 1 ? '' : 's'} selected</p>
        {error && <div className="toast toast-error">{error}</div>}
        {successMessage && <div className="toast toast-success">{successMessage}</div>}
      </section>

      <section className="file-list-card">
        {files.length === 0 ? (
          <p className="empty-state">No audio files selected yet. Choose files to start.</p>
        ) : (
          <div className="file-table">
            {files.map((file) => (
              <div key={file.id} className="file-row">
                <div className="file-details">
                  <strong>{file.filename}</strong>
                  <div className="status-line">
                    <span>{file.uploadStatus === 'ready' ? 'Ready to upload' : file.uploadStatus === 'uploading' ? 'Uploading...' : file.uploadStatus === 'uploaded' ? 'Uploaded' : 'Upload failed'}</span>
                    {file.transcriptionStatus && <span className={`status-pill status-${file.transcriptionStatus}`}>{file.transcriptionStatus}</span>}
                  </div>
                </div>
                <div className="file-actions">
                  {file.transcriptText && (
                    <button className="small-button" onClick={() => saveTranscript(file)}>
                      Download transcript
                    </button>
                  )}
                  {file.transcriptionStatus === 'completed' && file.fileId && (
                    <button className="small-button danger" onClick={() => deleteSonioxFile(file)}>
                      Delete from Soniox
                    </button>
                  )}
                </div>
                {file.error && <p className="file-error">{file.error}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="footer-note">
        <p>Jobs are polled automatically when active. Leave the page open until all files are completed.</p>
        {polling && anyPending && <p>Polling in progress...</p>}
        {hasJobs && !anyPending && <p>All transcription jobs have finished.</p>}
      </section>
    </div>
  );
}

export default App;

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
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!polling) return;
    const interval = window.setInterval(() => {
      pollTranscriptions();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [polling, files]);

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
    const payload = {
      model: 'stt-async-preview',
      file_id: fileId,
      filename,
      client_reference_id: filename
    };

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

    setFiles((prev) => prev.map((item) => item.id === file.id ? { ...item, fileId: undefined, transcriptionId: undefined, transcriptionStatus: undefined, transcriptText: undefined, uploadStatus: 'ready' } : item));
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
        <label className="field-label">Soniox API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Paste your Soniox API key here"
        />

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
          <button className="secondary-button" onClick={clearAll}>
            Clear all
          </button>
        </div>

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

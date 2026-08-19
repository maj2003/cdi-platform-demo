// ---------------------------------------------------------------------------
// src/components/capture/CameraCapture.jsx
//
// Take Photo, as a camera — a live preview and a shutter, not a file picker.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS SEPARATELY FROM UPLOAD
//
// Both buttons previously opened the same hidden <input type=file>, so "Take
// Photo" was a lie on a desktop and only accidentally right on a tablet. They are
// different actions: Upload attaches a file that already exists, Take Photo makes
// one. At a teardown bench the second is the common case, and it should not route
// through a file dialog.
//
// ---------------------------------------------------------------------------
// THE PLACEHOLDER IS A REAL STATE, NOT A STUB
//
// getUserMedia fails for several ordinary reasons — no camera on the machine,
// permission refused, another app holding the device, or the page served over
// plain http from a LAN address (it needs a secure context; localhost counts as
// one). Each of those gets its own sentence, because "camera unavailable" leaves
// an engineer at a bench with nothing to try. Upload stays offered in every
// failure case, so the workflow is never blocked by the camera.
//
// THE STREAM IS ALWAYS STOPPED. A live camera left running holds the device,
// keeps the indicator light on, and drains a tablet — so every exit path
// (capture, cancel, unmount, error) goes through stop().
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, RotateCcw, Upload, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Turn a getUserMedia rejection into something an engineer can act on. */
function explain(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was refused. Allow camera access for this site in the browser\'s address bar, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this machine. Upload a photo instead, or open the workstation on a tablet.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy — another application is probably using it. Close that and try again.';
    default:
      return err?.message || 'The camera could not be started.';
  }
}

/**
 * @param {object}   props
 * @param {Function} props.onCaptured  (File) => void — a JPEG of the still
 * @param {Function} props.onCancel
 * @param {Function} props.onUploadInstead  offered in every failure state
 * @param {boolean}  [props.inline=false]  render into an existing photo frame —
 *   no outer border, no heading, no aspect box of its own. The review asked for the
 *   camera to appear in "The Part" panel rather than opening a second experience.
 */
export default function CameraCapture({ onCaptured, onCancel, onUploadInstead, inline = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | starting | live | unavailable
  const [error, setError] = useState(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus('starting');

    // Checked explicitly rather than letting getUserMedia throw: this is the
    // http-from-a-LAN-address case, and it deserves its own explanation because
    // the fix is "use localhost or https", not "grant permission".
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setError(
        window.isSecureContext === false
          ? 'The browser only allows camera access on a secure origin. This page is served over plain http, so use localhost or https.'
          : 'This browser does not expose a camera API.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The rear camera on a tablet held over a part; ignored on a laptop.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {
          /* autoplay policies: the muted playsInline attributes below cover this */
        });
      }
      setStatus('live');
    } catch (err) {
      stop();
      setStatus('unavailable');
      setError(explain(err));
    }
  }, [stop]);

  // Cleanup ONLY. The camera is started by a user action rather than on mount,
  // for two reasons: a synchronous setState from an effect body is what React's
  // compiler lint rejects, and — more usefully — an engineer at a bench should not
  // have the camera light come on just because a panel opened. The idle state below
  // is the camera-preview placeholder.
  //
  // This half is not optional: a live stream left running holds the device, keeps
  // the indicator lit and drains a tablet, so every exit path must reach stop().
  useEffect(() => stop, [stop]);

  const shoot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        // A File, not a Blob: every store and upload path in this app takes a
        // File and reads .name and .type off it.
        onCaptured?.(new File([blob], `capture-${stamp}.jpg`, { type: 'image/jpeg' }));
        stop();
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <div
      className={inline ? 'space-y-2' : 'space-y-2 rounded-lg border p-3'}
      data-testid="camera-capture"
    >
      {!inline && (
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {status === 'live' ? 'Camera — live' : 'Camera'}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              stop();
              onCancel?.();
            }}
            aria-label="Close camera"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div
        className="relative overflow-hidden rounded-md border bg-black"
        style={{ aspectRatio: '4 / 3' }}
      >
        {inline && (
          <span className="absolute left-2 top-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white">
            {status === 'live' ? 'Camera — live' : 'Camera'}
          </span>
        )}
        {inline && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1 z-10 h-7 px-2 text-white hover:bg-white/20"
            onClick={() => {
              stop();
              onCancel?.();
            }}
            aria-label="Close camera"
          >
            <X className="size-4" />
          </Button>
        )}
        {/* Kept mounted in every state so the ref is attached before the stream
            arrives — attaching after would need a second effect and a re-render. */}
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className={`size-full object-cover ${status === 'live' ? '' : 'invisible'}`}
        />

        {status === 'idle' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted p-4 text-center">
            <Camera className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Camera preview</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Press <strong>Start camera</strong> to open a live preview and take the shot here,
              instead of picking a file.
            </p>
          </div>
        )}

        {status === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <Camera className="size-8 animate-pulse" />
            <p className="text-sm">Starting camera…</p>
          </div>
        )}

        {status === 'unavailable' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted p-4 text-center">
            <AlertTriangle className="size-7 text-warning" />
            <p className="text-sm font-medium">Camera preview unavailable</p>
            <p className="max-w-xs text-xs text-muted-foreground">{error}</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {status === 'live' && (
          <Button size="sm" onClick={shoot}>
            <Camera className="mr-1.5 size-4" />
            Capture
          </Button>
        )}
        {status === 'idle' && (
          <Button size="sm" onClick={start}>
            <Camera className="mr-1.5 size-4" />
            Start camera
          </Button>
        )}
        {(status === 'unavailable' || status === 'starting') && (
          <Button variant="outline" size="sm" onClick={start} disabled={status === 'starting'}>
            <RotateCcw className="mr-1.5 size-4" />
            {status === 'starting' ? 'Starting…' : 'Retry camera'}
          </Button>
        )}
        {/* Offered in EVERY state, not only on failure: the point is that the
            capture workflow is never blocked by the camera. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            stop();
            onUploadInstead?.();
          }}
        >
          <Upload className="mr-1.5 size-4" />
          Upload instead
        </Button>
      </div>

      {status === 'unavailable' && (
        <Alert>
          <AlertTitle className="text-sm">Planned: tablet capture</AlertTitle>
          <AlertDescription className="text-xs">
            In production these photos are taken on a tablet at the bench and stored against
            the same Photo ID. This preview uses whatever camera the browser exposes.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

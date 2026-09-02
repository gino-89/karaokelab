/**
 * Karaoke Video Exporter: Records 60fps Canvas + Mixed Web Audio into downloadable WebM/MP4
 */

export class VideoRecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording = false;

  public startRecording(
    canvas: HTMLCanvasElement,
    audioStream: MediaStream,
    onProgress?: (timeElapsed: number) => void
  ): boolean {
    try {
      if (this.isRecording) {
        this.stopRecordingSilent();
      }
      this.recordedChunks = [];

      // Capture video stream from Canvas
      const captureStreamFn = canvas.captureStream || (canvas as any).mozCaptureStream;
      if (!captureStreamFn) {
        throw new Error('Canvas captureStream is not supported in this browser');
      }

      const canvasStream: MediaStream = captureStreamFn.call(canvas, 60);
      const videoTrack = canvasStream.getVideoTracks()[0];
      const audioTrack = audioStream.getAudioTracks()[0];

      if (!videoTrack) {
        throw new Error('No video track available from canvas');
      }

      // Combine video and audio tracks
      const combinedTracks: MediaStreamTrack[] = [videoTrack];
      if (audioTrack) {
        combinedTracks.push(audioTrack);
      }
      const combinedStream = new MediaStream(combinedTracks);

      // Check supported MIME types in order of preference
      const supportedMimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
      ];

      let selectedMimeType = '';
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
        for (const type of supportedMimeTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            selectedMimeType = type;
            break;
          }
        }
      }

      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: 4_500_000, // 4.5 Mbps crisp 1080p/720p quality
      };
      if (selectedMimeType) {
        recorderOptions.mimeType = selectedMimeType;
      }

      this.mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(250); // Collect slices every 250ms
      this.isRecording = true;

      return true;
    } catch (err) {
      console.error('Error starting video recording:', err);
      this.isRecording = false;
      return false;
    }
  }

  public stopRecording(filename: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.isRecording) {
        return reject(new Error('Recorder not active'));
      }

      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        const mimeType = this.mediaRecorder?.mimeType || 'video/webm';
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const cleanName = filename.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'Karaoke';
        this.downloadBlob(blob, `${cleanName}_Lyrical_Karaoke.${ext}`);
        resolve(blob);
      };

      this.mediaRecorder.onerror = (event) => {
        this.isRecording = false;
        reject(event);
      };

      this.mediaRecorder.stop();
    });
  }

  public stopRecordingSilent() {
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop();
      } catch (_) {}
      this.isRecording = false;
    }
  }

  public isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  private downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }
}

export const videoRecorder = new VideoRecorderService();

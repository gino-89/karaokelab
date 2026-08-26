import { Mp3Encoder } from '@breezystack/lamejs';

/**
 * Encodes any Audio WAV/Audio Blob to crystal clear MP3 320 kbps (Studio Quality).
 * Shrinks stems by 90% (~70MB -> ~7MB) with zero perceptible loss.
 */
export async function convertWavBlobToMp3_320kbps(wavBlob: Blob): Promise<Blob> {
  const arrayBuffer = await wavBlob.arrayBuffer();
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioCtxClass();

  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channels = audioBuffer.numberOfChannels >= 2 ? 2 : 1;
    const sampleRate = audioBuffer.sampleRate;
    const kbps = 320; // Maximum studio MP3 bitrate

    const encoder = new Mp3Encoder(channels, sampleRate, kbps);
    const mp3Chunks: Uint8Array[] = [];

    const sampleBlockSize = 1152;
    const numSamples = audioBuffer.length;

    if (channels === 1) {
      const left = audioBuffer.getChannelData(0);
      const leftInt16 = new Int16Array(left.length);
      for (let i = 0; i < left.length; i++) {
        const s = Math.max(-1, Math.min(1, left[i]));
        leftInt16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      for (let i = 0; i < numSamples; i += sampleBlockSize) {
        const chunk = leftInt16.subarray(i, i + sampleBlockSize);
        const mp3buf = encoder.encodeBuffer(chunk);
        if (mp3buf && mp3buf.length > 0) {
          mp3Chunks.push(new Uint8Array(mp3buf));
        }
      }
    } else {
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;

      const leftInt16 = new Int16Array(left.length);
      const rightInt16 = new Int16Array(right.length);

      for (let i = 0; i < left.length; i++) {
        const sL = Math.max(-1, Math.min(1, left[i]));
        leftInt16[i] = sL < 0 ? sL * 0x8000 : sL * 0x7fff;

        const sR = Math.max(-1, Math.min(1, right[i]));
        rightInt16[i] = sR < 0 ? sR * 0x8000 : sR * 0x7fff;
      }

      for (let i = 0; i < numSamples; i += sampleBlockSize) {
        const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
        const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
        const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf && mp3buf.length > 0) {
          mp3Chunks.push(new Uint8Array(mp3buf));
        }
      }
    }

    const endBuf = encoder.flush();
    if (endBuf && endBuf.length > 0) {
      mp3Chunks.push(new Uint8Array(endBuf));
    }

    return new Blob(mp3Chunks as BlobPart[], { type: 'audio/mp3' });
  } finally {
    audioCtx.close().catch(() => {});
  }
}

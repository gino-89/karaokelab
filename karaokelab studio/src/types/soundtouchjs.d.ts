declare module 'soundtouchjs' {
  export class SoundTouch {
    rate: number;
    tempo: number;
    pitch: number;
    pitchSemitones: number;
    clear(): void;
  }

  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
    extract(target: Float32Array, numFrames: number, position: number): number;
  }

  export class SimpleFilter {
    constructor(source: WebAudioBufferSource, soundtouch: SoundTouch, onEnd?: () => void);
    sourcePosition: number;
    extract(target: Float32Array, numFrames: number): number;
  }

  export function getWebAudioNode(
    context: AudioContext,
    filter: SimpleFilter,
    onUpdate?: (position: number) => void,
    bufferSize?: number
  ): ScriptProcessorNode;

  export class PitchShifter {
    constructor(
      context: AudioContext,
      buffer: AudioBuffer,
      bufferSize?: number,
      onEnd?: () => void
    );
    duration: number;
    timePlayed: number;
    sourcePosition: number;
    percentagePlayed: number;
    tempo: number;
    rate: number;
    pitch: number;
    pitchSemitones: number;
    node: ScriptProcessorNode;
    connect(toNode: AudioNode): void;
    disconnect(): void;
    on(eventName: string, cb: (detail: any) => void): void;
    off(eventName?: string): void;
  }
}

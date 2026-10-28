declare module 'fastnoise-lite' {
  export default class FastNoiseLite {
    static readonly NoiseType: { readonly OpenSimplex2S: string };
    static readonly FractalType: { readonly None: string };
    constructor(seed?: number);
    SetSeed(seed: number): void;
    SetFrequency(frequency: number): void;
    SetNoiseType(type: string): void;
    SetFractalType(type: string): void;
    GetNoise(x: number, y: number): number;
  }
}

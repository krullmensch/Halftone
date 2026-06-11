declare module 'esm-potrace-wasm' {
  export function init(): Promise<void>;
  export function potrace(
    input: ImageBitmapSource | HTMLCanvasElement,
    options?: Record<string, unknown>,
  ): Promise<string>;
}

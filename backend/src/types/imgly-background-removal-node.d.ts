/**
 * Local type declaration for @imgly/background-removal-node.
 *
 * Needed because the package uses `exports` map in package.json which TypeScript's
 * "moduleResolution": "node" doesn't resolve automatically.
 * The types are correct — we're just bridging the resolution gap.
 */
declare module "@imgly/background-removal-node" {
  type ImageSource =
    | string
    | URL
    | Buffer
    | ArrayBuffer
    | Uint8Array
    | Blob
    | File;

  interface Config {
    publicPath?: string;
    debug?: boolean;
    proxyToWorker?: boolean;
    fetchArgs?: RequestInit;
    model?: "small" | "medium";
    output?: {
      format?: "image/png" | "image/jpeg" | "image/webp";
      quality?: number;
      type?: "foreground" | "background" | "mask";
    };
  }

  /**
   * Removes the background from an image using ML segmentation (BRIAAI RMBG-1.4).
   * Works on complex real-world backgrounds — not just plain white.
   * @returns PNG Blob with transparent background
   */
  export function removeBackground(
    image: ImageSource,
    configuration?: Config,
  ): Promise<Blob>;

  export function removeForeground(
    image: ImageSource,
    configuration?: Config,
  ): Promise<Blob>;

  export function segmentForeground(
    image: ImageSource,
    configuration?: Config,
  ): Promise<Blob>;

  export default removeBackground;
}

import { pngSize } from "./png.ts";
import { FigmaClient } from "./client.ts";
import { figmaNodeToSnapshot, type TranslateResult } from "./translate.ts";
import { parseFigmaUrl } from "./url.ts";

export interface FetchDesignOptions {
  /** URL del frame (`figma.com/design/<key>/…?node-id=1-2`). */
  url: string;
  client: FigmaClient;
  scale?: 1 | 2;
  /** `false` para no pedir la imagen. */
  image?: boolean;
  /** Nombre de archivo de la imagen dentro del snapshot. */
  imageName?: string;
  now?: () => Date;
}

export interface FetchDesignResult extends TranslateResult {
  /** PNG del frame, si se pidió. */
  image: Buffer | undefined;
}

/** De la URL de un frame al snapshot de diseño (y su imagen). Es lo que usa `paridad figma`. */
export async function fetchDesignSnapshot(options: FetchDesignOptions): Promise<FetchDesignResult> {
  const { fileKey, nodeId } = parseFigmaUrl(options.url);
  const scale = options.scale ?? 2;
  const { response, document } = await options.client.getNode(fileKey, nodeId);

  let image: Buffer | undefined;
  let imageMeta: { path: string; width: number; height: number } | undefined;
  if (options.image !== false) {
    image = await options.client.getImage(fileKey, nodeId, scale);
    const { width, height } = pngSize(image);
    imageMeta = { path: options.imageName ?? "design.png", width, height };
  }
  const variables = await options.client.getLocalVariables(fileKey);
  const entry = response.nodes[nodeId];
  const result = figmaNodeToSnapshot(document, {
    fileKey,
    nodeId,
    scale,
    ...(imageMeta ? { image: imageMeta } : {}),
    ...(entry?.styles ? { styleNames: entry.styles as Record<string, { name?: string }> } : {}),
    variables,
    ...(options.now ? { now: options.now } : {}),
  });
  return { ...result, image };
}

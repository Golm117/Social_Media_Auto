// TODO: slice 9
export interface Publisher {
  publish(
    videoPath: string,
    caption: string,
    targets: string[],
  ): Promise<Array<{ platform: string; ok: boolean; error?: string }>>;
}

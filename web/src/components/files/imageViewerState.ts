import { create } from 'zustand'

/** 应用内图片预览：保存 Blob，由预览组件自己创建/释放 object URL */
export type ImageViewerImage = { blob: Blob; name: string }

type ImageViewerState = {
  image: ImageViewerImage | null
  zoomed: boolean
  openImage: (image: ImageViewerImage) => void
  closeImage: () => void
  toggleZoom: () => void
}

export const useImageViewer = create<ImageViewerState>((set) => ({
  image: null,
  zoomed: false,
  openImage: (image) => set({ image, zoomed: false }),
  closeImage: () => set({ image: null, zoomed: false }),
  toggleZoom: () => set((state) => ({ zoomed: !state.zoomed })),
}))

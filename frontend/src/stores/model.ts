import { defineStore } from 'pinia'
import { getManifest } from '@/services/api'
import { clearModels, downloadModel, hasModel } from '@/services/modelCache'
import type { Manifest, ModelRef } from '@/types/api'

export type ModelStatus =
  'idle' | 'loading-manifest' | 'downloading' | 'downloaded' | 'initializing' | 'ready' | 'error'

export const useModelStore = defineStore('model', {
  state: () => ({
    status: 'idle' as ModelStatus,
    manifest: null as Manifest | null,
    active: null as ModelRef | null,
    received: 0,
    total: 0,
    error: null as string | null,
    manifestError: null as string | null,
  }),
  getters: {
    progress: (s) => (s.total ? Math.min(100, Math.round((s.received / s.total) * 100)) : 0),
  },
  actions: {
    async loadManifest() {
      this.status = 'loading-manifest'
      this.manifestError = null
      try {
        this.manifest = await getManifest()
        this.setActive(this.manifest)
      } catch (e) {
        this.manifestError = e instanceof Error ? e.message : String(e)
      } finally {
        this.status = 'idle'
      }
    },
    setActive(ref: ModelRef) {
      this.active = { id: ref.id, url: ref.url, size: ref.size }
      this.total = ref.size
      this.received = 0
    },
    async download() {
      if (!this.active) throw new Error('manifest not loaded')
      const { id, url, size } = this.active
      this.status = 'downloading'
      this.error = null
      try {
        if (await hasModel(id, url)) {
          this.received = size
        } else {
          await downloadModel(id, url, size, (r) => (this.received = r), undefined)
        }
        this.status = 'downloaded'
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
      }
    },
    retry() {
      return this.download()
    },
    async useFallback() {
      if (!this.manifest?.fallback) return
      this.setActive(this.manifest.fallback)
      await this.download()
    },
    async clearCache() {
      await clearModels()
      this.received = 0
      this.status = 'idle'
    },
  },
})

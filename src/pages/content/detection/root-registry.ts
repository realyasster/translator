/**
 * Belge ve açık Shadow DOM köklerinin kaydı.
 *
 * Sürekli `querySelectorAll('*')` çalıştırmaz; ağaç gezintisi 4 ms veya 200
 * öğelik parçalara bölünür. Mutation callback'i pahalı tarama yapmaz,
 * yalnızca değişen kökleri kuyruğa ekler.
 */

const SHOW_ELEMENT = 1

export interface RootRegistryOptions {
  batchMs?: number
  maxElementsPerChunk?: number
  budgetMs?: number
  now?: () => number
  schedule?: (fn: () => void, ms: number) => number
  cancel?: (handle: number) => void
}

interface PendingWalk {
  root: Document | ShadowRoot
  walker: TreeWalker
}

export class RootRegistry {
  private readonly doc: Document
  private readonly options: Required<
    Pick<RootRegistryOptions, 'batchMs' | 'maxElementsPerChunk' | 'budgetMs'>
  > &
    RootRegistryOptions
  private roots: Array<Document | ShadowRoot> = []
  private observers = new Map<Document | ShadowRoot, MutationObserver>()
  private mutationSubscription: ((roots: Array<Document | ShadowRoot>) => void) | null =
    null
  private rootSubscription: (() => void) | null = null
  private dirty = new Set<Document | ShadowRoot>()
  private flushHandle: number | null = null
  private pendingWalks: PendingWalk[] = []
  private walkHandle: number | null = null
  private running = false

  constructor(doc: Document, options: RootRegistryOptions = {}) {
    this.doc = doc
    this.options = {
      batchMs: 100,
      maxElementsPerChunk: 200,
      budgetMs: 4,
      ...options,
    }
  }

  public start(): void {
    if (this.running) return
    this.running = true
    this.addRoot(this.doc)
    this.scanRoot(this.doc)
    this.notifyRootsChanged()
  }

  public stop(): void {
    this.running = false
    if (this.flushHandle !== null) {
      this.cancelTimer(this.flushHandle)
      this.flushHandle = null
    }
    if (this.walkHandle !== null) {
      this.cancelTimer(this.walkHandle)
      this.walkHandle = null
    }
    this.pendingWalks = []
    this.dirty.clear()
    for (const observer of Array.from(this.observers.values())) observer.disconnect()
    this.observers.clear()
    this.roots = []
    this.mutationSubscription = null
    this.rootSubscription = null
  }

  public getRoots(): Array<Document | ShadowRoot> {
    return this.roots.slice()
  }

  public onMutation(
    cb: (roots: Array<Document | ShadowRoot>) => void,
  ): () => void {
    this.mutationSubscription = cb
    return () => {
      if (this.mutationSubscription === cb) this.mutationSubscription = null
    }
  }

  public onRootsChanged(cb: () => void): () => void {
    this.rootSubscription = cb
    return () => {
      if (this.rootSubscription === cb) this.rootSubscription = null
    }
  }

  /**
   * Sağlık kontrolü: kaldırılan kökleri temizler, sonradan açılan ShadowRoot
   * ve host'ları bulur. `deep` yalnızca video bulunmayan sayfada beş saniyede
   * bir çalıştırılır.
   */
  public healthCheck(deep = false): void {
    if (!this.running) return
    for (const root of this.roots.slice()) {
      const host = (root as ShadowRoot).host
      if (host && !host.isConnected) {
        this.removeRoot(root)
      }
    }
    if (deep) {
      for (const root of this.roots.slice()) {
        this.scanRoot(root)
      }
    }
    this.notifyRootsChanged()
  }

  private addRoot(root: Document | ShadowRoot): void {
    if (this.roots.includes(root)) return
    this.roots.push(root)
    this.observe(root)
  }

  private removeRoot(root: Document | ShadowRoot): void {
    const index = this.roots.indexOf(root)
    if (index >= 0) this.roots.splice(index, 1)
    const observer = this.observers.get(root)
    if (observer) {
      observer.disconnect()
      this.observers.delete(root)
    }
    this.dirty.delete(root)
    this.rootsChanged = true
  }

  private rootsChanged = false

  private observe(root: Document | ShadowRoot): void {
    if (this.observers.has(root)) return
    try {
      const observer = new MutationObserver((records) => {
        if (!this.running) return
        for (const record of records) {
          const targetRoot = this.rootForNode(record.target)
          if (targetRoot) this.dirty.add(targetRoot)
          for (const added of Array.from(record.addedNodes)) {
            if (added.nodeType !== 1) continue
            const el = added as Element
            if (el.shadowRoot) {
              this.addRoot(el.shadowRoot)
              this.scanRoot(el.shadowRoot)
              this.rootsChanged = true
            }
            if (el.tagName && el.tagName.toLowerCase() === 'video') {
              this.dirty.add(root)
            }
            // Alt ağaçta sonradan eklenen host'ları sınırlı gezintiyle tara.
            if (el.firstElementChild) {
              try {
                const walker = this.doc.createTreeWalker(el, SHOW_ELEMENT, null)
                let child = walker.nextNode() as Element | null
                let count = 0
                while (child && count < 200) {
                  if (child.shadowRoot) {
                    this.addRoot(child.shadowRoot)
                    this.scanRoot(child.shadowRoot)
                    this.rootsChanged = true
                  }
                  child = walker.nextNode() as Element | null
                  count += 1
                }
              } catch {
                // yoksay
              }
            }
          }
        }
        this.scheduleFlush()
      })
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      this.observers.set(root, observer)
    } catch {
      // Bazı belgelerde observer oluşturulamaz.
    }
  }

  private rootForNode(node: Node): Document | ShadowRoot | null {
    try {
      const root = node.getRootNode()
      if (root.nodeType === 9 || root.nodeType === 11) {
        return root as Document | ShadowRoot
      }
    } catch {
      // yoksay
    }
    return null
  }

  private notifyRootsChanged(): void {
    if (!this.rootsChanged) return
    this.rootsChanged = false
    if (this.rootSubscription) this.rootSubscription()
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== null || !this.running) return
    this.flushHandle = this.scheduleTimer(() => {
      this.flushHandle = null
      const roots = Array.from(this.dirty)
      this.dirty.clear()
      if (!roots.length) return
      if (this.mutationSubscription) this.mutationSubscription(roots)
      this.notifyRootsChanged()
    }, this.options.batchMs)
  }

  private scanRoot(root: Document | ShadowRoot): void {
    const walkRoot =
      root.nodeType === 9
        ? (root as Document).documentElement
        : ((root as ShadowRoot).firstElementChild as Element | null)
    if (!walkRoot) return
    try {
      const walker = this.doc.createTreeWalker(walkRoot, SHOW_ELEMENT, null)
      this.pendingWalks.push({ root, walker })
      this.processWalks()
    } catch {
      // yoksay
    }
  }

  private processWalks(): void {
    if (!this.running) return
    if (this.walkHandle !== null) return
    const now =
      this.options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
    const start = now()
    let processed = 0

    while (this.pendingWalks.length) {
      const current = this.pendingWalks[0]
      let node = current.walker.currentNode as Element | null
      while (node) {
        if (
          processed >= this.options.maxElementsPerChunk ||
          now() - start >= this.options.budgetMs
        ) {
          this.walkHandle = this.scheduleTimer(() => {
            this.walkHandle = null
            this.processWalks()
          }, 0)
          return
        }
        processed += 1
        const el = node as Element
        if (el.shadowRoot) {
          const shadow = el.shadowRoot
          if (!this.roots.includes(shadow)) {
            this.addRoot(shadow)
            this.rootsChanged = true
          }
          if (!this.pendingWalks.some((walk) => walk.root === shadow)) {
            const first = shadow.firstElementChild
            if (first) {
              this.pendingWalks.push({
                root: shadow,
                walker: this.doc.createTreeWalker(first, SHOW_ELEMENT, null),
              })
            }
          }
        }
        node = current.walker.nextNode() as Element | null
      }
      this.pendingWalks.shift()
    }
  }

  private scheduleTimer(fn: () => void, ms: number): number {
    if (this.options.schedule) return this.options.schedule(fn, ms)
    return (globalThis.setTimeout as typeof setTimeout)(fn, ms) as unknown as number
  }

  private cancelTimer(handle: number): void {
    if (this.options.cancel) {
      this.options.cancel(handle)
      return
    }
    ;(globalThis.clearTimeout as typeof clearTimeout)(handle)
  }
}



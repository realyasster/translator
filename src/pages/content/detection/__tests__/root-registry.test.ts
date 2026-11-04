import { RootRegistry } from '../root-registry'

beforeEach(() => {
  document.body.innerHTML = ''
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('RootRegistry', () => {
  it('açık ShadowRoot köklerini bulur', () => {
    const host = document.createElement('div')
    host.id = 'host'
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<div>Shadow content</div>'
    document.body.appendChild(host)

    const registry = new RootRegistry(document)
    registry.start()
    expect(registry.getRoots()).toContain(shadow)
    registry.stop()
  })

  it('sonradan eklenen host ve iç içe ShadowRoot köklerini bulur', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    const innerHost = document.createElement('div')
    const innerShadow = innerHost.attachShadow({ mode: 'open' })
    shadow.appendChild(innerHost)
    document.body.appendChild(host)

    const registry = new RootRegistry(document)
    registry.start()
    registry.healthCheck(true)

    expect(registry.getRoots()).toContain(shadow)
    expect(registry.getRoots()).toContain(innerShadow)
    registry.stop()
  })

  it('kaldırılan host kökünü ve observer temizliğini yapar', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    document.body.appendChild(host)

    const registry = new RootRegistry(document)
    registry.start()
    expect(registry.getRoots()).toContain(shadow)

    host.remove()
    registry.healthCheck(true)
    expect(registry.getRoots()).not.toContain(shadow)
    registry.stop()
    expect(registry.getRoots()).toHaveLength(0)
  })

  it('değişen kökleri 100 ms içinde bildirir', async () => {
    document.body.innerHTML = '<div id="page"></div>'
    const registry = new RootRegistry(document, { batchMs: 100 })
    const onMutation = jest.fn()
    registry.onMutation(onMutation)
    registry.start()

    const div = document.createElement('div')
    div.textContent = 'changed'
    document.getElementById('page')?.appendChild(div)

    await Promise.resolve()
    jest.advanceTimersByTime(100)
    expect(onMutation).toHaveBeenCalled()
    registry.stop()
  })

  it('on kez başlat/durdur kökleri ve observerları çoğaltmaz', () => {
    const registry = new RootRegistry(document)
    for (let i = 0; i < 10; i += 1) {
      registry.start()
      registry.stop()
    }
    expect(registry.getRoots()).toHaveLength(0)
  })
})

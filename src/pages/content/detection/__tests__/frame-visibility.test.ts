import { FrameVisibilityBridge } from '../frame-visibility'

function messageEvent(source: any, data: any): MessageEvent {
  return { source, data } as MessageEvent
}

describe('FrameVisibilityBridge', () => {
  it('top frame kendi viewport görünür alanını bilir', () => {
    const bridge = new FrameVisibilityBridge({
      window,
      document,
      isTopFrame: true,
    })
    expect(bridge.isKnown()).toBe(true)
    expect(bridge.getVisibleRegion()).toEqual({
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    })
    expect(bridge.isFrameVisible()).toBe(true)
  })

  it('çocuk frame parent geometrisiyle kesişimi hesaplar', () => {
    const bridge = new FrameVisibilityBridge({
      window,
      document,
      isTopFrame: false,
    })
    expect(bridge.isKnown()).toBe(false)
    expect(bridge.getVisibleRegion()).toBeNull()

    ;(bridge as any).handleMessage(
      messageEvent(window.parent, {
        type: 'SUBTITLE_TRANSLATOR_FRAME_VISIBILITY',
        visible: true,
        region: { left: 10, top: 20, width: 300, height: 200 },
      }),
    )

    expect(bridge.isKnown()).toBe(true)
    expect(bridge.getVisibleRegion()).toEqual({
      left: 10,
      top: 20,
      width: 300,
      height: 200,
    })
    expect(bridge.isFrameVisible()).toBe(true)
  })

  it('parent görünmezse bölge yok sayılır', () => {
    const bridge = new FrameVisibilityBridge({
      window,
      document,
      isTopFrame: false,
    })
    ;(bridge as any).handleMessage(
      messageEvent(window.parent, {
        type: 'SUBTITLE_TRANSLATOR_FRAME_VISIBILITY',
        visible: false,
        region: { left: 0, top: 0, width: 300, height: 200 },
      }),
    )
    expect(bridge.isKnown()).toBe(true)
    expect(bridge.getVisibleRegion()).toBeNull()
    expect(bridge.isFrameVisible()).toBe(false)
  })

  it('viewport dışına taşan parent bölgesini keser', () => {
    const bridge = new FrameVisibilityBridge({
      window,
      document,
      isTopFrame: false,
    })
    ;(bridge as any).handleMessage(
      messageEvent(window.parent, {
        type: 'SUBTITLE_TRANSLATOR_FRAME_VISIBILITY',
        visible: true,
        region: {
          left: -100,
          top: -50,
          width: window.innerWidth + 100,
          height: window.innerHeight + 50,
        },
      }),
    )
    expect(bridge.getVisibleRegion()).toEqual({
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    })
  })

  it('parent dışındaki kaynaktan gelen mesajı yok sayar', () => {
    const bridge = new FrameVisibilityBridge({
      window,
      document,
      isTopFrame: false,
    })
    ;(bridge as any).handleMessage(
      messageEvent({}, {
        type: 'SUBTITLE_TRANSLATOR_FRAME_VISIBILITY',
        visible: true,
        region: { left: 0, top: 0, width: 300, height: 200 },
      }),
    )
    expect(bridge.isKnown()).toBe(false)
    expect(bridge.getVisibleRegion()).toBeNull()
  })

  it('bozuk geometri mesajını yok sayar', () => {
    const bridge = new FrameVisibilityBridge({
      window,
      document,
      isTopFrame: false,
    })
    ;(bridge as any).handleMessage(
      messageEvent(window.parent, {
        type: 'SUBTITLE_TRANSLATOR_FRAME_VISIBILITY',
        visible: true,
        region: { width: 100 },
      }),
    )
    expect(bridge.getVisibleRegion()).toBeNull()
  })
})
